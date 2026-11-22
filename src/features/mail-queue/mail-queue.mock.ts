import type MailQueueEntity from '@/features/mail-queue/mail-queue.entity';
import { MailQueueStatusEnum } from '@/features/mail-queue/mail-queue.entity';
import {
	MailQueueValidator,
	OrderByEnum,
} from '@/features/mail-queue/mail-queue.validator';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

export function getMailQueueEntityMock(): MailQueueEntity {
	return {
		id: mockId(1),
		template_id: mockId(1),
		language: 'en',
		content: {
			subject: 'Test email',
			html: 'This is the html',
		},
		to: {
			name: 'To Name',
			address: 'to@sample.com',
		},
		from: {
			name: 'From Name',
			address: 'from@sample.com',
		},
		status: MailQueueStatusEnum.ERROR,
		sent_at: createPastDate(28800),
		created_at: createPastDate(24000),
		updated_at: createPastDate(25000),
	};
}

export const mailQueueInputPayloads = {
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			id: mockId(1),
			template: 'test',
			status: MailQueueStatusEnum.ERROR,
			content: 'test',
			to: 'to@mail',
			sent_date_start: formatDate(createPastDate(14400)),
			sent_date_end: formatDate(createPastDate(7200)),
		},
	},
	delete: { ids: [mockId(1), mockId(2), mockId(3)] },
};

export const mailQueueOutputPayloads = {
	find: new MailQueueValidator('mail-queue').find.parse(
		mailQueueInputPayloads.find,
	),
};
