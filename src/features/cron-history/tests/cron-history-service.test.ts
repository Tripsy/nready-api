import { jest } from '@jest/globals';
import type CronHistoryEntity from '@/features/cron-history/cron-history.entity';
import { cronHistoryOutputPayloads } from '@/features/cron-history/cron-history.mock';
import type { CronHistoryQuery } from '@/features/cron-history/cron-history.repository';
import { CronHistoryService } from '@/features/cron-history/cron-history.service';
import type { CronHistoryValidator } from '@/features/cron-history/cron-history.validator';
import {
	createMockRepository,
	testServiceDeleteMultiple,
	testServiceFindByFilter,
	testServiceFindById,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

describe('CronHistoryService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const { query, repository } = createMockRepository<
		CronHistoryEntity,
		CronHistoryQuery
	>();
	const serviceCronHistory = new CronHistoryService(repository);

	testServiceDeleteMultiple<CronHistoryEntity, CronHistoryQuery>(
		query,
		serviceCronHistory,
		{
			ids: [mockId(1), mockId(2), mockId(3)],
		},
	);
	testServiceFindById<CronHistoryEntity, CronHistoryQuery>(
		query,
		serviceCronHistory,
	);
	testServiceFindByFilter<
		CronHistoryEntity,
		CronHistoryQuery,
		CronHistoryValidator
	>(query, serviceCronHistory, cronHistoryOutputPayloads.find);
});
