import { jest } from '@jest/globals';
import type MailQueueEntity from '@/features/mail-queue/mail-queue.entity';
import { mailQueueOutputPayloads } from '@/features/mail-queue/mail-queue.mock';
import type { MailQueueQuery } from '@/features/mail-queue/mail-queue.repository';
import { MailQueueService } from '@/features/mail-queue/mail-queue.service';
import type { MailQueueValidator } from '@/features/mail-queue/mail-queue.validator';
import {
	createMockRepository,
	testServiceDeleteMultiple,
	testServiceFindByFilter,
	testServiceFindById,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

describe('MailQueueService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const { query, repository } = createMockRepository<
		MailQueueEntity,
		MailQueueQuery
	>();
	const serviceMailQueue = new MailQueueService(repository);

	testServiceDeleteMultiple<MailQueueEntity, MailQueueQuery>(
		query,
		serviceMailQueue,
		{
			ids: [mockId(1), mockId(2), mockId(3)],
		},
	);
	testServiceFindById<MailQueueEntity, MailQueueQuery>(
		query,
		serviceMailQueue,
	);

	testServiceFindByFilter<
		MailQueueEntity,
		MailQueueQuery,
		MailQueueValidator
	>(query, serviceMailQueue, mailQueueOutputPayloads.find);
});
