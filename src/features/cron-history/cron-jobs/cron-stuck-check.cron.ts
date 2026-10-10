import { CronHistoryStatusEnum } from '@/features/cron-history/cron-history.entity';
import { getCronHistoryRepository } from '@/features/cron-history/cron-history.repository';
import { createCurrentDate, dateDiff } from '@/helpers/date.helper';
import {
	getCronJobsPaths,
	getCronLockLease,
	loadCronJob,
	MAX_RUN_TIME,
} from '@/providers/cron.provider';

export const SCHEDULE_EXPRESSION = '53 * * * *';
export const EXPECTED_RUN_TIME = 3; // seconds

/**
 * Closes the `cron_history` rows left `running` past their job's lock lease, as `error`.
 *
 * Past the lease the run is over one way or the other: its process died, or it hung and the lock
 * it held has expired, so the next tick may already have started a second copy. Recording it as
 * an error is what puts it in front of someone - `cron-error-count` reports the last 24 hours, and
 * this runs hourly so a stuck row is closed well inside that window.
 *
 * A hung job that does finish later overwrites the row with its real outcome.
 *
 * A row whose job is no longer on disk (removed or renamed since it started) is measured against
 * the lease floor.
 */
const cronStuckCheck = async () => {
	const leases = new Map<string, number>();

	for (const filePath of getCronJobsPaths()) {
		const job = await loadCronJob(filePath);

		leases.set(job.name, getCronLockLease(job.expected_run_time));
	}

	const now = createCurrentDate();

	const running = await getCronHistoryRepository()
		.createQuery()
		.filterBy('status', CronHistoryStatusEnum.RUNNING)
		.all();

	const stuck = running.filter(
		(entry) =>
			now.getTime() - entry.start_at.getTime() >
			(leases.get(entry.label) ?? getCronLockLease(0)),
	);

	for (const entry of stuck) {
		entry.status = CronHistoryStatusEnum.ERROR;
		entry.end_at = now;
		entry.run_time = Math.min(
			dateDiff(entry.start_at, now, 'seconds'),
			MAX_RUN_TIME,
		);
		entry.content = {
			message: 'The run did not finish within its lock lease',
		};
	}

	if (stuck.length > 0) {
		await getCronHistoryRepository().save(stuck);
	}

	return {
		stuck: stuck.map((entry) => ({
			id: entry.id,
			label: entry.label,
			start_at: entry.start_at,
		})),
	};
};

export default cronStuckCheck;
