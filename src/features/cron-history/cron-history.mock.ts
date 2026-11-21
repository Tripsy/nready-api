import type CronHistoryEntity from '@/features/cron-history/cron-history.entity';
import { CronHistoryStatusEnum } from '@/features/cron-history/cron-history.entity';
import {
	CronHistoryValidator,
	OrderByEnum,
} from '@/features/cron-history/cron-history.validator';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

export function getCronHistoryEntityMock(): CronHistoryEntity {
	return {
		id: mockId(1),
		label: 'cronErrorCount',
		start_at: createPastDate(28800),
		end_at: createPastDate(28900),
		status: CronHistoryStatusEnum.ERROR,
		run_time: 1,
		content: { warnings: [{ label: 'cronTimeCheck' }] },
	};
}

export const cronHistoryInputPayloads = {
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			id: mockId(1),
			term: 'test',
			status: CronHistoryStatusEnum.ERROR,
			start_date_start: formatDate(createPastDate(14400)),
			start_date_end: formatDate(createPastDate(7200)),
		},
	},
	delete: { ids: [mockId(1), mockId(2), mockId(3)] },
};

export const cronHistoryOutputPayloads = {
	find: new CronHistoryValidator('cron-history').find.parse(
		cronHistoryInputPayloads.find,
	),
};
