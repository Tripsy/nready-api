import fs from 'node:fs';
import cron from 'node-cron';
import { v7 as uuid } from 'uuid';
import {
	RequestContextSourceEnum,
	requestContext,
} from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import { ModuleError, NotFoundError } from '@/exceptions';
import CronHistoryEntity, {
	CronHistoryStatusEnum,
} from '@/features/cron-history/cron-history.entity';
import { getCronHistoryRepository } from '@/features/cron-history/cron-history.repository';
import { createCurrentDate, dateDiff } from '@/helpers/date.helper';
import {
	getErrorMessage,
	getFeaturesFilesPathByFolderAndExtension,
	getFileNameWithoutExtension,
	getSharedFilePathsByExtension,
} from '@/helpers/system.helper';
import { createLock, type Lock } from '@/providers/lock.provider';
import { getCronLogger, getSystemLogger } from '@/providers/logger.provider';

export function getCronJobsPaths() {
	const sharedFolder = `${Configuration.get('folder.shared')}/cron-jobs`;
	const featuresFolder = Configuration.get('folder.features') as string;
	const fileExtension = `cron.${Configuration.resolveExtension()}`;

	const sharedPaths = getSharedFilePathsByExtension(
		sharedFolder,
		fileExtension,
	);
	const featurePaths = getFeaturesFilesPathByFolderAndExtension(
		featuresFolder,
		'/cron-jobs',
		fileExtension,
	);

	return [...sharedPaths, ...featurePaths];
}

export async function startCronJobs() {
	setCronLogger();

	const cronJobsPaths = getCronJobsPaths();

	const promises = cronJobsPaths.map(async (filePath) => {
		try {
			const cronJobData = await loadCronJob(filePath);

			scheduleCronJob(cronJobData);

			return { name: cronJobData.name, status: 'fulfilled' } as const;
		} catch (error) {
			const skip = error instanceof ModuleError;
			const errorMsg = `${getErrorMessage(error) || `CronJobs setup errors`}`;

			return {
				name: filePath,
				status: 'rejected',
				reason: errorMsg,
				skip: skip,
			} as const;
		}
	});

	const results = await Promise.all(promises);

	const successful = results
		.filter((r) => r.status === 'fulfilled')
		.map((r) => r.name);

	const failed = results
		.filter((r) => r.status === 'rejected' && !r.skip)
		.map((r) => r.reason ?? 'unknown');

	if (successful.length) {
		getSystemLogger().debug(`Cron jobs started: ${successful.join(', ')}`);
	}

	if (failed.length) {
		getSystemLogger().error(failed, `Cron jobs errors`);
	}
}

/*
 * How long a job's lock survives a holder that never releases it - a process killed mid-run,
 * or a job that hangs. Generous on purpose: a job still running when its lease expires loses the
 * lock without knowing, and the next tick, on this instance or another, starts a second copy.
 * The floor keeps the short jobs (`EXPECTED_RUN_TIME` of a few seconds) clear of a slow
 * database day.
 */
const LOCK_LEASE_MULTIPLIER = 20;
const LOCK_LEASE_FLOOR_MS = 5 * 60 * 1000;

// `cron_history.run_time` is a smallint
export const MAX_RUN_TIME = 32767;

export function getCronLockLease(expectedRunTime: number): number {
	return Math.max(
		expectedRunTime * 1000 * LOCK_LEASE_MULTIPLIER,
		LOCK_LEASE_FLOOR_MS,
	);
}

export function createCronLock(data: CronJobData): Lock {
	return createLock(
		`cron:${data.name}`,
		getCronLockLease(data.expected_run_time),
	);
}

/**
 * Run a cron job and record it in `cron_history`.
 *
 * The row is written as `running` before the job starts and completed after it ends, so a job
 * that hangs - or a process that dies mid-run - leaves a `running` row behind instead of
 * nothing; `cron-stuck-check` reports those.
 *
 * Takes no lock: the scheduler holds one through its run coordinator, the CLI takes its own.
 */
export async function executeCron(
	data: CronJobData,
): Promise<CronHistoryEntity> {
	return requestContext.run(
		{
			auth_id: 0,
			performed_by: data.name,
			source: RequestContextSourceEnum.CRON,
			request_id: uuid(),
			language: 'en',
		},
		async () => {
			const repository = getCronHistoryRepository();

			const cronHistoryEntity = new CronHistoryEntity();
			cronHistoryEntity.label = data.name;
			cronHistoryEntity.start_at = createCurrentDate();
			cronHistoryEntity.end_at = null;
			cronHistoryEntity.status = CronHistoryStatusEnum.RUNNING;

			await repository.save(cronHistoryEntity);

			try {
				cronHistoryEntity.content = await data.jobFunction();
				cronHistoryEntity.status = CronHistoryStatusEnum.OK;
			} catch (error) {
				if (error instanceof NotFoundError) {
					cronHistoryEntity.status = CronHistoryStatusEnum.OK;
					cronHistoryEntity.content = {
						removed: 0,
					};
				} else if (error instanceof Error) {
					cronHistoryEntity.status = CronHistoryStatusEnum.ERROR;
					cronHistoryEntity.content = {
						message: error.message,
					};

					getCronLogger().error(error, error.message);
				} else {
					cronHistoryEntity.status = CronHistoryStatusEnum.ERROR;
					cronHistoryEntity.content = {
						message: 'Unknown error',
					};

					getCronLogger().error(error, 'Unknown error');
				}
			} finally {
				cronHistoryEntity.end_at = createCurrentDate();
				// Clamped to the smallint column; a run that long is a WARNING regardless
				cronHistoryEntity.run_time = Math.min(
					dateDiff(
						cronHistoryEntity.start_at,
						cronHistoryEntity.end_at,
						'seconds',
					),
					MAX_RUN_TIME,
				);

				if (
					cronHistoryEntity.run_time > data.expected_run_time &&
					cronHistoryEntity.status !== CronHistoryStatusEnum.ERROR
				) {
					cronHistoryEntity.status = CronHistoryStatusEnum.WARNING;
				}

				await repository.save(cronHistoryEntity);
			}

			return cronHistoryEntity;
		},
	);
}

export type CronJobData = {
	name: string;
	filePath: string;
	schedule_expression: string;
	expected_run_time: number;
	jobFunction: () => Promise<Record<string, unknown>>;
};

export async function loadCronJob(filePath: string): Promise<CronJobData> {
	if (!fs.existsSync(filePath)) {
		throw new ModuleError();
	}

	const module = await import(filePath);

	if (!module.default || typeof module.default !== 'function') {
		throw new Error(`No default export function found in ${filePath}`);
	}

	if (
		!module.SCHEDULE_EXPRESSION ||
		typeof module.SCHEDULE_EXPRESSION !== 'string'
	) {
		throw new Error(
			`Invalid or missing SCHEDULE_EXPRESSION in ${filePath}`,
		);
	}

	if (
		!module.EXPECTED_RUN_TIME ||
		typeof module.EXPECTED_RUN_TIME !== 'number'
	) {
		throw new Error(`Invalid or missing EXPECTED_RUN_TIME in ${filePath}`);
	}

	// Validate cron expression
	if (!cron.validate(module.SCHEDULE_EXPRESSION)) {
		throw new Error(
			`Invalid cron expression "${module.SCHEDULE_EXPRESSION}" in ${filePath}`,
		);
	}

	return {
		name: getFileNameWithoutExtension(filePath),
		filePath: filePath,
		schedule_expression: module.SCHEDULE_EXPRESSION,
		expected_run_time: module.EXPECTED_RUN_TIME,
		jobFunction: module.default,
	};
}

/**
 * Two guards, one per scope:
 *
 * - `noOverlap` stops this process starting a tick while its previous run is still going,
 *   without a Redis round trip.
 * - The run coordinator stops every *other* process: a tick runs only on the instance that takes
 *   the job's lock, which is keyed by job name rather than by tick. So a second replica neither
 *   repeats the tick nor starts the next one while the first is still running.
 *
 * Fail-closed: with Redis unreachable `shouldRun` rejects and node-cron skips the tick - a missed
 * run is recovered by the next one, a duplicate run (two invoice reminders, two digests) is not.
 */
function scheduleCronJob(data: CronJobData) {
	const lock = createCronLock(data);

	const task = cron.schedule(
		data.schedule_expression,
		async () => {
			await executeCron(data);
		},
		{
			name: data.name,
			timezone: Configuration.get('app.timezone') || 'UTC',
			noOverlap: true,
			distributed: true,
			runCoordinator: {
				shouldRun: () => lock.acquire(),
				onComplete: () => lock.release(),
			},
		},
	);

	task.on('execution:overlap', () => {
		getCronLogger().warn(
			`Cron ${data.name} skipped: the previous run is still in progress`,
		);
	});

	task.on('execution:skipped', (context) => {
		if (context.reason === 'coordinator-error') {
			getCronLogger().error(
				`Cron ${data.name} skipped: its lock could not be checked`,
			);

			return;
		}

		// Normal with several instances - one of them took the tick
		getCronLogger().debug(
			`Cron ${data.name} skipped: the lock is held elsewhere`,
		);
	});
}

/**
 * Route node-cron's own messages (a task that throws past `executeCron`, a missed tick) to the
 * cron log instead of the console.
 */
function setCronLogger() {
	cron.setLogger({
		info: (message) => getCronLogger().info(message),
		warn: (message) => getCronLogger().warn(message),
		error: (message, error) =>
			getCronLogger().error(
				error ?? message,
				typeof message === 'string' ? message : message.message,
			),
		debug: (message) =>
			getCronLogger().debug(
				typeof message === 'string' ? message : message.message,
			),
	});
}

/**
 * Stop scheduling and wait up to `timeout` ms for the runs in progress, so the shutdown that
 * follows does not close the database under a job still writing to it.
 */
export async function stopCronJobs(timeout: number): Promise<void> {
	await cron.shutdown(timeout);
}

export default startCronJobs;
