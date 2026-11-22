// First, before any module that defines a TypeORM entity evaluates
import 'reflect-metadata';
import 'dotenv/config';
import { createServer, type Server } from 'node:http';
import { createApp } from '@/app';
import { bootstrap, resolveAppPort } from '@/bootstrap';
import { redisClose } from '@/config/init-redis.config';
import {
	cleanupWebSockets,
	setupWebSockets,
} from '@/config/init-websocket.setup';
import { getRoutesInfo } from '@/config/routes.setup';
import { Configuration } from '@/config/settings.config';
import { stopCronJobs } from '@/providers/cron.provider';
import { destroyDatabase } from '@/providers/database.provider';
import { getLogStream, getSystemLogger } from '@/providers/logger.provider';
import { queueFactory } from '@/queues/queue.factory';
import { closeEmailWorker } from '@/workers/email.worker';

let server: Server | undefined;
let isShuttingDown = false;

const FORCE_SHUTDOWN_TIMEOUT = Configuration.get('app.shutdown_timeout');

/*
 * How long a cron run in progress and the open HTTP connections get to finish. Kept under the
 * force timeout so `closeHandler` still gets its turn in the time that is left.
 */
const DRAIN_TIMEOUT = Math.floor(FORCE_SHUTDOWN_TIMEOUT * 0.6);

async function start() {
	// 1. Infrastructure first
	await bootstrap();

	// 2. Create Express app
	const app = await createApp();

	// 3. Create the HTTP server and attach WebSockets before it accepts a connection
	const httpServer = createServer(app);
	server = httpServer;

	await setupWebSockets(httpServer);

	// 4. Listen - a bind failure (EADDRINUSE, EACCES) rejects instead of passing for a start
	const appPort = resolveAppPort();

	await new Promise<void>((resolve, reject) => {
		httpServer.once('error', reject);
		httpServer.listen(appPort, () => {
			httpServer.off('error', reject);
			getSystemLogger().debug(`Server listening on port ${appPort}`);
			resolve();
		});
	});

	// 5. Setup signal handlers
	setupSignalHandlers();

	// 6. Print startup banner
	printStartupInfo(appPort);
}

start().catch((error) => {
	console.error(error);

	// Logger can also generate errors (e.g: DB related, etc.), there is no error throw from here, just check alternative logs
	getSystemLogger().fatal(error, 'Application startup failed');

	process.exit(1);
});

function setupSignalHandlers() {
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));

	// A crash still drains gracefully, but exits non-zero so a supervisor sees the failure
	process.on('uncaughtException', (error) => {
		getSystemLogger().fatal(error, 'Uncaught exception');
		shutdown('uncaughtException', 1);
	});

	process.on('unhandledRejection', (reason) => {
		getSystemLogger().fatal(reason, 'Unhandled rejection');
		shutdown('unhandledRejection', 1);
	});
}

function shutdown(signal: string, exitCode: 0 | 1 = 0): void {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;

	getSystemLogger().debug(
		`${signal} signal received. Starting graceful shutdown...`,
	);

	if (!server) {
		getSystemLogger().debug('No server instance to close');

		process.exit(exitCode);
	}

	const httpServer = server;

	/*
	 * Stops new ticks at once, alongside the HTTP drain rather than after it, and gives a run in
	 * progress part of the grace period - the connections it writes through are closed only once
	 * it has settled or timed out.
	 */
	const cronsStopped = stopCronJobs(DRAIN_TIMEOUT).catch((error) => {
		getSystemLogger().warn(error, 'Cron jobs stop warning');
	});

	httpServer.close(() => {
		cronsStopped
			.then(() => closeHandler())
			.then(() => {
				getSystemLogger().debug('Shutdown complete');
				process.exit(exitCode);
			})
			.catch((err) => {
				getSystemLogger().fatal(err, 'Shutdown error');
				process.exit(1);
			});
	});

	/*
	 * `server.close()` stops accepting and closes idle keep-alive connections, but its callback
	 * waits for every other connection. An upgraded websocket socket never becomes idle, so the
	 * gateways are torn down now, not from `closeHandler`, which only runs after that callback.
	 * A gateway's `cleanup` must therefore terminate its own clients.
	 */
	cleanupWebSockets();

	/*
	 * A connection busy at shutdown is not closed when its response goes out, and a slow one may
	 * not finish at all. Once the drain window is up, every connection still open is cut, so the
	 * close callback - and `closeHandler` with it - runs inside the force timeout.
	 */
	setTimeout(() => {
		httpServer.closeAllConnections();
	}, DRAIN_TIMEOUT).unref();

	setTimeout(() => {
		getSystemLogger().fatal(
			`Forcing shutdown after ${FORCE_SHUTDOWN_TIMEOUT}ms`,
		);
		process.exit(1);
	}, FORCE_SHUTDOWN_TIMEOUT).unref();
}

type CloseOperation = {
	readonly name: string;
	readonly fn: () => unknown;
};

/*
 * Stages run in order; the operations inside one stage run in parallel. Each stage only
 * closes what nothing in a later stage still uses:
 *
 *  1. consumers - the email worker, whose in-progress jobs still write to the database and log
 *     (websocket gateways are closed earlier, by `shutdown`, since they hold `server.close()`)
 *  2. queues - producers, now that nothing enqueues from a job or a socket
 *  3. connections - database and Redis
 *  4. the log stream, alone and last, so every "closed" / "close warning" line above it
 *     still reaches it
 */
const CLOSE_STAGES: readonly (readonly CloseOperation[])[] = [
	[{ name: 'Email worker', fn: closeEmailWorker }],
	[{ name: 'Queues', fn: () => queueFactory.closeAll() }],
	[
		{ name: 'Database', fn: destroyDatabase },
		{ name: 'Redis', fn: redisClose },
	],
	[{ name: 'Log streams', fn: () => getLogStream().close() }],
];

export async function closeHandler(): Promise<void> {
	for (const stage of CLOSE_STAGES) {
		await Promise.allSettled(
			stage.map(async ({ name, fn }) => {
				try {
					await fn();

					getSystemLogger().debug(`${name} closed successfully`);
				} catch (error) {
					getSystemLogger().warn(error, `${name} close warning`);
				}
			}),
		);
	}
}

// Print startup info
function printStartupInfo(port: number): void {
	const appConfig = {
		port,
		environment: Configuration.environment(),
		name: Configuration.get('app.name'),
		url: Configuration.get('app.url'),
	};

	if (appConfig.environment === 'test') {
		return;
	}

	const width = 60;
	const lines = [
		['Environment:', appConfig.environment],
		['Port:', appConfig.port],
		['URL:', `${appConfig.url}:${appConfig.port}`],
		['Health:', `${appConfig.url}:${appConfig.port}/health`],
	];

	console.debug(`┌${'─'.repeat(width + 2)}┐`);
	console.debug(`│ ${appConfig.name.padEnd(width)} │`);
	console.debug(`├${'─'.repeat(width + 2)}┤`);

	for (const [label, value] of lines) {
		const text = `${label} ${value}`.padEnd(width);
		console.debug(`│ ${text} │`);
	}

	// Display routes
	if (appConfig.environment === 'development') {
		const routes = getRoutesInfo();

		if (routes.length > 0) {
			console.debug(`├${'─'.repeat(width + 2)}┤`);
			console.debug(
				`│ ${`Routes (${routes.length} total):`.padEnd(width)} │`,
			);
			console.debug(`│${' '.repeat(width + 2)}│`);

			routes.forEach((route) => {
				console.debug(
					`│ ${route.method.padEnd(7)} ${route.path.padEnd(width - 8)} │`,
				);
			});
		}
	}

	console.debug(`└${'─'.repeat(width + 2)}┘`);
}
