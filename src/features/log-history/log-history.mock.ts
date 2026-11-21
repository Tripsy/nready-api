import { RequestContextSourceEnum } from '@/config/request.context';
import type LogHistoryEntity from '@/features/log-history/log-history.entity';
import {
	LogHistoryValidator,
	OrderByEnum,
} from '@/features/log-history/log-history.validator';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { LogHistoryActionEnum } from '@/shared/types/log-history.type';
import { mockId } from '@/tests/mocks/uuid.mock';

export function getLogHistoryEntityMock(): LogHistoryEntity {
	return {
		id: mockId(1),
		entity: 'user',
		entity_id: mockId(1),
		action: LogHistoryActionEnum.CREATED,
		auth_id: mockId(1),
		performed_by: 'Gabriel',
		request_id: 'xxx',
		source: RequestContextSourceEnum.API,
		recorded_at: createPastDate(28800),
	};
}

export const logHistoryInputPayloads = {
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			entity: 'test',
			entity_id: mockId(1),
			action: 'create',
			request_id: 'xxx',
			source: RequestContextSourceEnum.API,
			recorded_at_start: formatDate(createPastDate(14400)),
			recorded_at_end: formatDate(createPastDate(7200)),
		},
	},
	delete: { ids: [mockId(1), mockId(2), mockId(3)] },
};

export const logHistoryOutputPayloads = {
	find: new LogHistoryValidator('log-history').find.parse(
		logHistoryInputPayloads.find,
	),
};
