import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import PermissionEntity from '@/features/permission/permission.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class PermissionQuery extends RepositoryAbstract<PermissionEntity> {
	constructor(repository: Repository<PermissionEntity>) {
		super(repository, PermissionEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'entity',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'operation',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getPermissionRepository = () =>
	dataSource.getRepository(PermissionEntity).extend({
		createQuery() {
			return new PermissionQuery(this);
		},
	});
