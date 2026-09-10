import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import WarehouseEntity from '@/features/warehouse/warehouse.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class WarehouseQuery extends RepositoryAbstract<WarehouseEntity> {
	constructor(repository: Repository<WarehouseEntity>) {
		super(repository, WarehouseEntity.NAME);
	}

	/**
	 * A numeric term is read as an id, matching the dashboard's other lists. Otherwise both the
	 * name and the short code are searched - the code is what a warehouse is called day to day,
	 * so a list that only matched the name would miss the way people actually search.
	 */
	filterByTerm(term?: string): this {
		if (term) {
			if (!Number.isNaN(Number(term)) && term.trim() !== '') {
				this.filterBy('id', Number(term));
			} else {
				if (term.length >= Configuration.get('filter.termMinLength')) {
					this.filterAny([
						{
							column: 'name',
							value: term,
							operator: 'ILIKE',
						},
						{
							column: 'code',
							value: term,
							operator: 'ILIKE',
						},
					]);
				}
			}
		}

		return this;
	}
}

export const getWarehouseRepository = () =>
	dataSource.getRepository(WarehouseEntity).extend({
		createQuery() {
			return new WarehouseQuery(this);
		},
	});
