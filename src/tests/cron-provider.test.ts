import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from '@jest/globals';
import type CronHistoryEntity from '@/features/cron-history/cron-history.entity';
import { CronHistoryStatusEnum } from '@/features/cron-history/cron-history.entity';

/*
 * Redis and the history repository are replaced before the provider is imported - under the
 * ESM preset that means `unstable_mockModule` plus a dynamic import.
 */
const redisSet =
	jest.fn<
		(
			key: string,
			value: string,
			px: 'PX',
			lease: number,
			nx: 'NX',
		) => Promise<'OK' | null>
	>();
const redisEval =
	jest.fn<
		(
			script: string,
			keyCount: number,
			key: string,
			token: string,
		) => Promise<number>
	>();

jest.unstable_mockModule('@/config/init-redis.config', () => ({
	getRedisClient: () => ({ set: redisSet, eval: redisEval }),
	redisClose: jest.fn(),
}));

// The status each save saw - the entity is mutated between the two saves, so the calls'
// arguments alone would show only the final state
const savedStatuses: string[] = [];
const historySave = jest.fn(async (entity: CronHistoryEntity) => {
	savedStatuses.push(entity.status);

	return entity;
});

jest.unstable_mockModule(
	'@/features/cron-history/cron-history.repository',
	() => ({
		getCronHistoryRepository: () => ({ save: historySave }),
	}),
);

const { createLock } = await import('@/providers/lock.provider');
const { executeCron, getCronLockLease } = await import(
	'@/providers/cron.provider'
);

type CronJobData = Parameters<typeof executeCron>[0];

function buildJob(
	jobFunction: CronJobData['jobFunction'],
	expectedRunTime: number = 10,
): CronJobData {
	return {
		name: 'test-job',
		filePath: '/tmp/test-job.cron.ts',
		schedule_expression: '* * * * *',
		expected_run_time: expectedRunTime,
		jobFunction,
	};
}

describe('lock provider', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should take the lock with SET NX and its lease', async () => {
		redisSet.mockResolvedValue('OK');

		const lock = createLock('cron:test-job', 60000);

		await expect(lock.acquire()).resolves.toBe(true);

		const [key, , px, lease, nx] = redisSet.mock.calls[0];

		expect(key).toBe(lock.key);
		expect(key.endsWith(':lock:cron:test-job')).toBe(true);
		expect(px).toBe('PX');
		expect(lease).toBe(60000);
		expect(nx).toBe('NX');
	});

	it('should report a lock held elsewhere', async () => {
		redisSet.mockResolvedValue(null);

		const lock = createLock('cron:test-job', 60000);

		await expect(lock.acquire()).resolves.toBe(false);

		await lock.release();

		expect(redisEval).not.toHaveBeenCalled();
	});

	it('should release only with the token it wrote', async () => {
		redisSet.mockResolvedValue('OK');
		redisEval.mockResolvedValue(1);

		const lock = createLock('cron:test-job', 60000);

		await lock.acquire();
		await lock.release();

		const written = redisSet.mock.calls[0][1];
		const [, keyCount, key, token] = redisEval.mock.calls[0];

		expect(keyCount).toBe(1);
		expect(key).toBe(lock.key);
		expect(token).toBe(written);
	});

	it('should not release twice', async () => {
		redisSet.mockResolvedValue('OK');
		redisEval.mockResolvedValue(1);

		const lock = createLock('cron:test-job', 60000);

		await lock.acquire();
		await lock.release();
		await lock.release();

		expect(redisEval).toHaveBeenCalledTimes(1);
	});
});

describe('getCronLockLease', () => {
	it('should apply the floor to short jobs', () => {
		expect(getCronLockLease(3)).toBe(5 * 60 * 1000);
	});

	it('should scale with longer jobs', () => {
		expect(getCronLockLease(30)).toBe(30 * 1000 * 20);
	});
});

describe('executeCron', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		savedStatuses.length = 0;
		jest.useFakeTimers({ now: new Date('2026-10-09T10:00:00Z') });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should record the run as running, then as ok', async () => {
		const result = await executeCron(
			buildJob(async () => ({ removed: 2 })),
		);

		expect(savedStatuses).toEqual([
			CronHistoryStatusEnum.RUNNING,
			CronHistoryStatusEnum.OK,
		]);
		expect(result.label).toBe('test-job');
		expect(result.content).toEqual({ removed: 2 });
		expect(result.end_at).toBeInstanceOf(Date);
	});

	it('should measure against the job expected run time', async () => {
		const job = buildJob(async () => {
			jest.setSystemTime(new Date('2026-10-09T10:00:05Z'));

			return {};
		}, 10);

		const result = await executeCron(job);

		expect(result.run_time).toBe(5);
		expect(result.status).toBe(CronHistoryStatusEnum.OK);
	});

	it('should mark a run over its expected time as warning', async () => {
		const job = buildJob(async () => {
			jest.setSystemTime(new Date('2026-10-09T10:00:15Z'));

			return {};
		}, 10);

		const result = await executeCron(job);

		expect(result.status).toBe(CronHistoryStatusEnum.WARNING);
	});

	it('should record a failing run as error', async () => {
		const result = await executeCron(
			buildJob(async () => {
				throw new Error('boom');
			}),
		);

		expect(savedStatuses).toEqual([
			CronHistoryStatusEnum.RUNNING,
			CronHistoryStatusEnum.ERROR,
		]);
		expect(result.content).toEqual({ message: 'boom' });
	});
});
