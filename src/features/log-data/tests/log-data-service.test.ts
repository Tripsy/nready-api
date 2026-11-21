import { jest } from '@jest/globals';
import type LogDataEntity from '@/features/log-data/log-data.entity';
import { logDataOutputPayloads } from '@/features/log-data/log-data.mock';
import type { LogDataQuery } from '@/features/log-data/log-data.repository';
import { LogDataService } from '@/features/log-data/log-data.service';
import type { LogDataValidator } from '@/features/log-data/log-data.validator';
import {
	createMockRepository,
	testServiceDeleteMultiple,
	testServiceFindByFilter,
	testServiceFindById,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

describe('LogDataService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const { query, repository } = createMockRepository<
		LogDataEntity,
		LogDataQuery
	>();
	const serviceLogData = new LogDataService(repository);

	testServiceDeleteMultiple<LogDataEntity, LogDataQuery>(
		query,
		serviceLogData,
		{
			ids: [mockId(1), mockId(2), mockId(3)],
		},
	);
	testServiceFindById<LogDataEntity, LogDataQuery>(query, serviceLogData);
	testServiceFindByFilter<LogDataEntity, LogDataQuery, LogDataValidator>(
		query,
		serviceLogData,
		logDataOutputPayloads.find,
	);
});
