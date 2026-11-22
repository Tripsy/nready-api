import type LogDataEntity from '@/features/log-data/log-data.entity';
import { getLogDataRepository } from '@/features/log-data/log-data.repository';
import type { LogDataValidator } from '@/features/log-data/log-data.validator';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class LogDataService {
	constructor(private repository: ReturnType<typeof getLogDataRepository>) {}

	public async delete(data: ValidatorOutput<LogDataValidator, 'delete'>) {
		return await this.repository
			.createQuery()
			.filterBy('id', data.ids, 'IN')
			.delete(false, true, true);
	}

	public findById(id: EntityId): Promise<LogDataEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<LogDataValidator, 'find'>) {
		return this.repository
			.createQuery()
			.filterById(data.filter.id)
			.filterByRange(
				'created_at',
				data.filter.create_at_start,
				data.filter.create_at_end,
			)
			.filterBy('category', data.filter.category)
			.filterBy('level', data.filter.level)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const logDataService = new LogDataService(getLogDataRepository());
