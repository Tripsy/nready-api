import type LogDataEntity from '@/features/log-data/log-data.entity';
import {
	LogDataValidator,
	OrderByEnum,
} from '@/features/log-data/log-data.validator';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	LogDataCategoryEnum,
	LogDataLevelEnum,
} from '@/shared/types/log-data.type';
import { mockId } from '@/tests/mocks/uuid.mock';

export function getLogDataEntityMock(): LogDataEntity {
	return {
		id: mockId(1),
		pid: 'yyy',
		request_id: 'xxx',
		category: 'system',
		level: LogDataLevelEnum.ERROR,
		message: 'Lorem ipsum',
		context: undefined,
		created_at: createPastDate(28800),
	};
}

export const logDataInputPayloads = {
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			id: mockId(1),
			category: LogDataCategoryEnum.SYSTEM,
			level: LogDataLevelEnum.ERROR,
			create_at_start: formatDate(createPastDate(14400)),
			create_at_end: formatDate(createPastDate(7200)),
			term: 'timeout',
		},
	},
	delete: { ids: [mockId(1), mockId(2), mockId(3)] },
};

export const logDataOutputPayloads = {
	find: new LogDataValidator('log-data').find.parse(
		logDataInputPayloads.find,
	),
};
