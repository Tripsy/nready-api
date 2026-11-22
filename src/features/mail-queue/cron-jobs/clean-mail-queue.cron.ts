import { getMailQueueRepository } from '@/features/mail-queue/mail-queue.repository';
import { createPastDate } from '@/helpers/date.helper';

export const SCHEDULE_EXPRESSION = '27 04 * * 0';
export const EXPECTED_RUN_TIME = 10; // seconds

/** Twelve months - mail is personal data, and nothing past a year is still needed. */
const RETENTION_DAYS = 365;

/*
 * Every queued mail keeps its recipient's name and address (`to`) and the rendered body, which
 * names them again - an order confirmation, a password reset - so the queue is personal data that
 * nothing else bounds. Rows past twelve months are dropped whatever their status: a mail still
 * pending after a year is not going out, and a sent or failed one has served its purpose.
 *
 * Filters on `created_at`, which every row has; `sent_at` is null on a mail never sent. The table
 * has no `deleted_at`, so the delete is a hard one.
 *
 * `delete` loads the matching rows and removes them one by one inside a transaction, so the cost
 * scales with the backlog: steady state is one week of year-old mail, the first run after deploy
 * clears everything already past the window - hence the generous expected run time.
 *
 * Runs Sundays at 04:27 inside the weekly cleanup block, offset from its neighbors
 * (`clean-account-recovery` :02, `clean-log-data` :17, `clean-comment-subscription` :37,
 * `clean-cron-history` :47, `clean-log-history` :57): `cron-time-check` reports jobs starting in
 * the same minute, and concurrent bulk deletes share one database.
 */
const cleanMailQueue = async () => {
	const countRemoved = await getMailQueueRepository()
		.createQuery()
		.filterByRange(
			'created_at',
			undefined,
			createPastDate(86400 * RETENTION_DAYS),
		)
		.delete(false, true, true);

	return {
		removed: countRemoved,
	};
};

export default cleanMailQueue;
