import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type { RequestContextSource } from '@/config/request.context';
import LogHistoryEntity from '@/features/log-history/log-history.entity';
import { createCurrentDate } from '@/helpers/date.helper';
import { getSystemLogger } from '@/providers/logger.provider';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { LogHistoryAction } from '@/shared/types/log-history.type';

export class LogHistoryQuery extends RepositoryAbstract<LogHistoryEntity> {
	constructor(repository: Repository<LogHistoryEntity>) {
		super(repository, LogHistoryEntity.NAME);
	}
}

export const getLogHistoryRepository = () =>
	dataSource.getRepository(LogHistoryEntity).extend({
		createQuery() {
			return new LogHistoryQuery(this);
		},

		createLogs(
			entity: string,
			entity_ids: EntityId[],
			action: LogHistoryAction,
			auth_id: EntityId | null,
			performed_by: string,
			request_id: string,
			source: RequestContextSource,
			details?: Record<string, string | number>,
		) {
			const recorded_at = createCurrentDate();

			getSystemLogger().info(
				`Creating log history for ${entity} ${entity_ids.join(', ')}`,
			);

			const records = entity_ids.map((entity_id) => {
				const log = new LogHistoryEntity();

				log.entity = entity;
				log.entity_id = entity_id;
				log.action = action;
				log.auth_id = auth_id;
				log.performed_by = performed_by;
				log.request_id = request_id;
				log.source = source;
				log.recorded_at = recorded_at;
				log.details = details;

				return log;
			});

			return this.save(records);
		},
	});
