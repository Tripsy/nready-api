import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import LogDataEntity from '@/features/log-data/log-data.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class LogDataQuery extends RepositoryAbstract<LogDataEntity> {
	constructor(repository: Repository<LogDataEntity>) {
		super(repository, LogDataEntity.NAME);
	}

	// Keep this as inspiration
	// filterByTerm(term?: string): this {
	// 	if (term) {
	// 		this.query.andWhere(
	// 			`(
	//                ${LogDataEntity.NAME}.id = :id
	//             OR ${LogDataEntity.NAME}.pid = :pid
	//             OR ${LogDataEntity.NAME}.message LIKE :message
	//             OR ${LogDataEntity.NAME}.context LIKE :context
	//         )`,
	// 			{
	// 				id: term,
	// 				pid: term,
	// 				message: `%${term}%`,
	// 				context: `%${term}%`,
	// 			},
	// 		);
	// 	}
	//
	// 	return this;
	// }

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'request_id',
						value: term,
						operator: '=',
					},
					{
						column: 'pid',
						value: term,
						operator: '=',
					},
					{
						column: 'message',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'context::text',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getLogDataRepository = () =>
	dataSource.getRepository(LogDataEntity).extend({
		createQuery() {
			return new LogDataQuery(this);
		},
	});
