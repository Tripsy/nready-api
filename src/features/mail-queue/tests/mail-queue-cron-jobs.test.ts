import { expect, jest } from '@jest/globals';
import cron from 'node-cron';
import type { MailQueueQuery } from '@/features/mail-queue/mail-queue.repository';
import { createMockQuery } from '@/tests/jest-service.setup';

/*
 * Same shape as `log-data-cron-jobs.test.ts`: the repository is replaced before the job is
 * imported, since `dataSource` is never initialized under `test`.
 */
const query = createMockQuery() as unknown as jest.Mocked<MailQueueQuery>;

jest.unstable_mockModule('@/features/mail-queue/mail-queue.repository', () => ({
	getMailQueueRepository: () => ({
		createQuery: () => query,
	}),
}));

const job = await import(
	'@/features/mail-queue/cron-jobs/clean-mail-queue.cron'
);

const DAY_IN_SECONDS = 86400;

describe('mail-queue cron jobs', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('clean-mail-queue module contract', () => {
		it('should default-export a function', () => {
			expect(typeof job.default).toBe('function');
		});

		it('should export a cron expression node-cron accepts', () => {
			expect(cron.validate(job.SCHEDULE_EXPRESSION)).toBe(true);
		});

		it('should export a numeric EXPECTED_RUN_TIME', () => {
			expect(job.EXPECTED_RUN_TIME).toBeGreaterThan(0);
		});
	});

	describe('clean-mail-queue', () => {
		it('should hard-delete rows created over 12 months ago', async () => {
			query.delete.mockResolvedValue(42);

			const result = await job.default();

			const [column, from, to] = query.filterByRange.mock.calls[0];

			expect(column).toBe('created_at');
			expect(from).toBeUndefined();

			// Asserted as a window so the test does not race the clock
			const expected = Date.now() - DAY_IN_SECONDS * 365 * 1000;

			expect((to as Date).getTime()).toBeGreaterThan(expected - 5000);
			expect((to as Date).getTime()).toBeLessThan(expected + 5000);

			// No `deleted_at` on the table: a soft delete would silently no-op
			expect(query.delete).toHaveBeenCalledWith(false, true, true);

			expect(result).toEqual({ removed: 42 });
		});
	});
});
