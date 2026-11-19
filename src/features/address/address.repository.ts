import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import AddressEntity from '@/features/address/address.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class AddressQuery extends RepositoryAbstract<AddressEntity> {
	constructor(repository: Repository<AddressEntity>) {
		super(repository, AddressEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (!Number.isNaN(Number(term)) && term.trim() !== '') {
				this.filterBy('id', Number(term));
			} else {
				if (term.length >= Configuration.get('filter.termMinLength')) {
					this.filterAny([
						{
							column: 'details',
							value: term,
							operator: 'ILIKE',
						},
						{
							column: 'postal_code',
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

export const getAddressRepository = () =>
	dataSource.getRepository(AddressEntity).extend({
		createQuery() {
			return new AddressQuery(this);
		},
	});

/**
 * A query bound to a caller's transaction rather than to the data source - for a caller that has to
 * read rows its own uncommitted transaction wrote (the demo seed, which runs as one transaction).
 */
export const createAddressQuery = (manager: EntityManager) =>
	new AddressQuery(manager.getRepository(AddressEntity));
