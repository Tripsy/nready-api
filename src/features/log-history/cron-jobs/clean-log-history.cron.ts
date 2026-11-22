import { getLogHistoryRepository } from '@/features/log-history/log-history.repository';
import { createPastDate } from '@/helpers/date.helper';

export const SCHEDULE_EXPRESSION = '57 04 * * 0';
export const EXPECTED_RUN_TIME = 30; // seconds

/** Twelve months - long enough to answer for a change, short of keeping it forever. */
const RETENTION_DAYS = 365;

/*
 * `log_history` is the audit trail - a row per write to an audited entity - and it ties each
 * change to who made it (`auth_id`, `performed_by`) and the record it touched, a user's own
 * included. That makes it personal data, and it gains a row on nearly every write, so without
 * this job it grows for as long as the instance runs.
 *
 * Filters on `recorded_at` (indexed), the entity's only timestamp. The table is append-only with
 * no `deleted_at`, so the delete is a hard one.
 *
 * `delete` loads the matching rows and removes them one by one inside a transaction, so the cost
 * scales with the backlog: steady state is one week of year-old history, but this is the busiest
 * table any cleanup touches, and the first run after deploy clears everything already past the
 * window - hence the longer expected run time.
 *
 * Runs Sundays at 04:57, last in the weekly cleanup block (`clean-account-recovery` :02,
 * `clean-log-data` :17, `clean-mail-queue` :27, `clean-comment-subscription` :37,
 * `clean-cron-history` :47), for the reasons given in `clean-mail-queue`.
 */
const cleanLogHistory = async () => {
	const countRemoved = await getLogHistoryRepository()
		.createQuery()
		.filterByRange(
			'recorded_at',
			undefined,
			createPastDate(86400 * RETENTION_DAYS),
		)
		.delete(false, true, true);

	return {
		removed: countRemoved,
	};
};

export default cleanLogHistory;
