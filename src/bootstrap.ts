import { setupFeatureBootstrap } from '@/config/bootstrap.setup';
import { initQueues } from '@/config/init-queue.config';
import { setupListeners } from '@/config/listeners.setup';
import { initializeMessages } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import startCronJobs from '@/providers/cron.provider';
import { initDatabase } from '@/providers/database.provider';
import { startEmailWorker } from '@/workers/email.worker';

/** The port the HTTP server binds to - the testing one under APP_ENV=test. */
export function resolveAppPort(): number {
	return Configuration.isEnvironment('test')
		? Configuration.get('app.port_while_testing')
		: Configuration.get('app.port');
}

function assertPositiveInteger(key: string, value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`Invalid ${key}: ${value}. Must be a positive integer`);
	}
}

// Validate critical configuration
function validateConfig(): void {
	const appPort = resolveAppPort();

	if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
		throw new Error(`Invalid port: ${appPort}. Must be 1-65535`);
	}

	assertPositiveInteger(
		'app.request_timeout',
		Configuration.get('app.request_timeout'),
	);
	assertPositiveInteger(
		'app.shutdown_timeout',
		Configuration.get('app.shutdown_timeout'),
	);
}

// Application bootstrap
export async function bootstrap(): Promise<void> {
	validateConfig();

	await initializeMessages();

	if (!Configuration.isEnvironment('test')) {
		await initDatabase();
		// Before the listeners, so a registry is populated before anything can consult it
		await setupFeatureBootstrap();
		await setupListeners();
		await initQueues();

		// Shut down from `server.ts` (`closeEmailWorker`), never by the worker itself
		if (Configuration.get('worker.enabled')) {
			startEmailWorker();
		}

		if (Configuration.get('cron.enabled')) {
			await startCronJobs();
		}
	}
}
