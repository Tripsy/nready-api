import { Command } from 'commander';
import { setupFeatureBootstrap } from '@/config/bootstrap.setup';
import { setupListeners } from '@/config/listeners.setup';
import { initializeMessages } from '@/config/message.setup';
import dataSource from '../src/config/data-source.config';
import {
	type CronJobData,
	createCronLock,
	executeCron,
	getCronJobsPaths,
	loadCronJob,
} from '../src/providers/cron.provider';

const BACKGROUND_DRAIN_MS = 500;

/** Gives fire-and-forget listener writes time to finish before the process exits. */
function drainBackgroundWork(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, BACKGROUND_DRAIN_MS));
}

const program = new Command();

/**
 * Every job the scheduler would register - the same discovery, so a new `*.cron.ts` is runnable
 * here without being listed anywhere.
 */
async function loadCronJobs(): Promise<Map<string, CronJobData>> {
	// Some job modules build validators or messages at import time, which reads the locales
	await initializeMessages();

	const jobs = new Map<string, CronJobData>();

	for (const filePath of getCronJobsPaths()) {
		const job = await loadCronJob(filePath);

		jobs.set(job.name, job);
	}

	return jobs;
}

program
	.command('run <cron-name>')
	.description('Run a specific cron job manually')
	.option(
		'-f, --force',
		'Run even while the job holds its lock (a scheduled run is in progress)',
	)
	.action(async (cronName: string, options: { force?: boolean }) => {
		const jobs = await loadCronJobs();
		const job = jobs.get(cronName);

		if (!job) {
			console.error(`Unknown cron: ${cronName}`);
			console.debug(
				`Available cron jobs: ${[...jobs.keys()].join(', ')}`,
			);

			process.exit(1);
		}

		await dataSource.initialize();

		/*
		 * The scheduled runs inherit both of these from `bootstrap.ts`; this runner has no
		 * bootstrap, so without them the audit trail and cache purges a job emits go nowhere
		 * (the job looks like it silently skipped them), and a job writing against a
		 * polymorphic target would find every target open because nothing registered a
		 * resolver.
		 */
		await setupFeatureBootstrap();
		await setupListeners();

		// The lock the scheduler takes, so a manual run cannot overlap a scheduled one
		const lock = createCronLock(job);

		if (!options.force && !(await lock.acquire())) {
			console.error(
				`${cronName} is already running (lock ${lock.key}); use --force to run anyway`,
			);

			process.exit(1);
		}

		try {
			console.debug(`Running ${cronName}...`);
			const result = await executeCron(job);
			console.debug('Result: ', result);
		} finally {
			await lock.release();
		}

		/*
		 * Listeners write through `runInBackground`, which is deliberately not awaited - a
		 * bare `process.exit` here outruns the insert. The server never faces this because it
		 * keeps running; a one-shot process has to give the handlers a tick to land.
		 */
		await drainBackgroundWork();

		process.exit(0);
	});

program
	.command('list')
	.description('List all available cron jobs')
	.option('-s, --system', 'List cron jobs from system (filesystem)')
	.action(async (options) => {
		if (options.system) {
			console.debug('System cron jobs:');

			// Shared + per-feature paths, the same list the scheduler itself registers
			getCronJobsPaths().forEach((path) => {
				console.debug(`  - ${path}`);
			});

			return;
		}

		const jobs = await loadCronJobs();

		console.debug('Cron jobs:');

		jobs.forEach((job) => {
			console.debug(`  - ${job.name} (${job.schedule_expression})`);
		});

		// Importing the jobs opens connections (Redis, queues) that keep the process alive
		process.exit(0);
	});

program.parseAsync();
