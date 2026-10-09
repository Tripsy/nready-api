import { setupFeatureBootstrap } from '@/config/bootstrap.setup';
import { initQueues } from '@/config/init-queue.config';
import { setupListeners } from '@/config/listeners.setup';
import { initializeMessages } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import startCronJobs from '@/providers/cron.provider';
import { initDatabase } from '@/providers/database.provider';

// Validate critical configuration
function validateConfig(): void {
	const required = ['app.port'] as const;
	const missing = required.filter((key) => !Configuration.get(key));

	if (missing.length > 0) {
		throw new Error(`Missing required config: ${missing.join(', ')}`);
	}

	const appPort = Number(Configuration.get('app.port'));

	// Port validation
	if (appPort < 1 || appPort > 65535) {
		throw new Error(`Invalid port: ${appPort}. Must be 1-65535`);
	}
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

		if (Configuration.get('worker.enabled')) {
			import('@/workers/email.worker').catch(console.error);
		}

		if (Configuration.get('cron.enabled')) {
			await startCronJobs();
		}
	}
}
