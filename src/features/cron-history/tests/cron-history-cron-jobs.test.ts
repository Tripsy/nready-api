import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from '@jest/globals';
import CronHistoryEntity, {
	CronHistoryStatusEnum,
} from '@/features/cron-history/cron-history.entity';
import type { CronHistoryQuery } from '@/features/cron-history/cron-history.repository';
import { createMockQuery } from '@/tests/jest-service.setup';

/*
 * `cron-stuck-check` discovers the jobs on disk and reads `cron_history`; both are replaced
 * before the job is imported - under the ESM preset that means `unstable_mockModule` plus a
 * dynamic import.
 */
const cronHistoryQuery =
	createMockQuery() as unknown as jest.Mocked<CronHistoryQuery>;
const historySave = jest.fn(async (entities: CronHistoryEntity[]) => entities);

jest.unstable_mockModule(
	'@/features/cron-history/cron-history.repository',
	() => ({
		getCronHistoryRepository: () => ({
			createQuery: () => cronHistoryQuery,
			save: historySave,
		}),
	}),
);

const LEASE_FLOOR_MS = 5 * 60 * 1000;

jest.unstable_mockModule('@/providers/cron.provider', () => ({
	getCronJobsPaths: () => ['/jobs/slow-job.cron.ts'],
	loadCronJob: async () => ({
		name: 'slow-job',
		filePath: '/jobs/slow-job.cron.ts',
		schedule_expression: '* * * * *',
		expected_run_time: 60,
		jobFunction: async () => ({}),
	}),
	// The real formula, restated: floor of 5 minutes, otherwise 20x the expected run time
	getCronLockLease: (expectedRunTime: number) =>
		Math.max(expectedRunTime * 1000 * 20, LEASE_FLOOR_MS),
	MAX_RUN_TIME: 32767,
}));

const { default: cronStuckCheck } = await import(
	'@/features/cron-history/cron-jobs/cron-stuck-check.cron'
);

const NOW = new Date('2026-10-09T10:00:00Z');

function buildRunning(
	id: number,
	label: string,
	startedMsAgo: number,
): CronHistoryEntity {
	const entry = new CronHistoryEntity();
	entry.id = id;
	entry.label = label;
	entry.start_at = new Date(NOW.getTime() - startedMsAgo);
	entry.end_at = null;
	entry.status = CronHistoryStatusEnum.RUNNING;
	entry.run_time = 0;

	return entry;
}

describe('cron-stuck-check', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers({ now: NOW });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should close only the runs past their job lease', async () => {
		// slow-job's lease is 20 minutes; an unknown label falls back to the 5 minute floor
		const withinLease = buildRunning(1, 'slow-job', 10 * 60 * 1000);
		const pastLease = buildRunning(2, 'slow-job', 25 * 60 * 1000);
		const unknownPastFloor = buildRunning(3, 'removed-job', 6 * 60 * 1000);

		cronHistoryQuery.all.mockResolvedValue([
			withinLease,
			pastLease,
			unknownPastFloor,
		] as never);

		const result = await cronStuckCheck();

		expect(cronHistoryQuery.filterBy).toHaveBeenCalledWith(
			'status',
			CronHistoryStatusEnum.RUNNING,
		);
		expect(result.stuck.map((entry) => entry.id)).toEqual([2, 3]);

		expect(withinLease.status).toBe(CronHistoryStatusEnum.RUNNING);
		expect(pastLease.status).toBe(CronHistoryStatusEnum.ERROR);
		expect(pastLease.end_at).toEqual(NOW);
		expect(pastLease.run_time).toBe(25 * 60);

		expect(historySave).toHaveBeenCalledWith([pastLease, unknownPastFloor]);
	});

	it('should save nothing when no run is stuck', async () => {
		cronHistoryQuery.all.mockResolvedValue([
			buildRunning(1, 'slow-job', 60 * 1000),
		] as never);

		const result = await cronStuckCheck();

		expect(result.stuck).toEqual([]);
		expect(historySave).not.toHaveBeenCalled();
	});
});
