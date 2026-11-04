import 'dotenv/config';
import type { Server } from 'node:http';
import { createApp } from '@/app';
import { bootstrap } from '@/bootstrap';
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

export let server: Server;
let isShuttingDown = false;

const FORCE_SHUTDOWN_TIMEOUT = Number(
	process.env.FORCE_SHUTDOWN_TIMEOUT ?? 10000,
);

// Under the force timeout, so the close operations still get their turn after it
const CRON_SHUTDOWN_TIMEOUT = Math.floor(FORCE_SHUTDOWN_TIMEOUT * 0.6);

async function start() {
	// 1. Infrastructure first
	await bootstrap();

	// 2. Create Express app
	const app = await createApp();

	// 3. Start HTTP server
	const appPort = Number(
		Configuration.isEnvironment('test')
			? Configuration.get('app.port_while_testing') || 3001
			: Configuration.get('app.port'),
	);

	// Express 5 hands a listen failure (EADDRINUSE, EACCES) to this callback rather than throwing
	await new Promise<void>((resolve, reject) => {
		server = app.listen(appPort, (error?: Error) => {
			if (error) {
				reject(error);

				return;
			}

			getSystemLogger().debug(`Server listening on port ${appPort}`);
			resolve();
		});
	});

	// 4. Setup WebSockets
	await setupWebSockets(server);

	// 5. Setup signal handlers
	setupSignalHandlers();

	// 6. Print startup banner
	printStartupInfo();
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

	process.on('uncaughtException', (error) => {
		getSystemLogger().fatal(error, 'Uncaught exception');
		shutdown('uncaughtException').then((r) => console.error(r));
	});

	process.on('unhandledRejection', (reason) => {
		getSystemLogger().fatal(reason, 'Unhandled rejection');
		shutdown('unhandledRejection').then((r) => console.error(r));
	});
}

async function shutdown(signal: string): Promise<void> {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;

	getSystemLogger().debug(
		`${signal} signal received. Starting graceful shutdown...`,
	);

	if (!server) {
		getSystemLogger().debug('No server instance to close');

		process.exit(0);
	}

	/*
	 * Stops new ticks at once, alongside the HTTP drain rather than after it, and gives a run in
	 * progress part of the grace period - the connections it writes through are closed only once
	 * it has settled or timed out.
	 */
	const cronsStopped = stopCronJobs(CRON_SHUTDOWN_TIMEOUT).catch((error) => {
		getSystemLogger().warn(error, 'Cron jobs stop warning');
	});

	server.close(() => {
		cronsStopped
			.then(() => closeHandler())
			.then(() => {
				getSystemLogger().debug('Shutdown complete');
				process.exit(0);
			})
			.catch((err) => {
				getSystemLogger().fatal(err, 'Shutdown error');
				process.exit(1);
			});
	});

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
 *  1. consumers - websocket clients and the email worker (whose in-progress jobs still write
 *     to the database and log)
 *  2. queues - producers, now that nothing enqueues from a job or a socket
 *  3. connections - database and Redis
 *  4. the log stream, alone and last, so every "closed" / "close warning" line above it
 *     still reaches it
 */
const CLOSE_STAGES: readonly (readonly CloseOperation[])[] = [
	[
		{ name: 'WebSockets', fn: () => cleanupWebSockets() },
		{ name: 'Email worker', fn: closeEmailWorker },
	],
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
function printStartupInfo(): void {
	const appConfig = {
		port: Configuration.get('app.port'),
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
