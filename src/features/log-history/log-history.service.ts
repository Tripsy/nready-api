import type LogHistoryEntity from '@/features/log-history/log-history.entity';
import { getLogHistoryRepository } from '@/features/log-history/log-history.repository';
import type { LogHistoryValidator } from '@/features/log-history/log-history.validator';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class LogHistoryService {
	constructor(
		private repository: ReturnType<typeof getLogHistoryRepository>,
	) {}

	public async delete(data: ValidatorOutput<LogHistoryValidator, 'delete'>) {
		return await this.repository
			.createQuery()
			.filterBy('id', data.ids, 'IN')
			.delete(false, true, true);
	}

	public findById(id: EntityId): Promise<LogHistoryEntity> {
		return this.repository
			.createQuery()
			.join('log_history.user', 'user', 'LEFT')
			.filterById(id)
			.firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<LogHistoryValidator, 'find'>) {
		return this.repository
			.createQuery()
			.join('log_history.user', 'user', 'LEFT')
			.filterBy('request_id', data.filter.request_id)
			.filterBy('entity', data.filter.entity)
			.filterBy('entity_id', data.filter.entity_id)
			.filterBy('action', data.filter.action)
			.filterBy('source', data.filter.source)
			.filterByRange(
				'recorded_at',
				data.filter.recorded_at_start,
				data.filter.recorded_at_end,
			)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const logHistoryService = new LogHistoryService(
	getLogHistoryRepository(),
);
