import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import ClientAddressEntity from '@/features/client-address/client-address.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ClientAddressQuery extends RepositoryAbstract<ClientAddressEntity> {
	constructor(repository: Repository<ClientAddressEntity>) {
		super(repository, ClientAddressEntity.NAME);
	}

	/**
	 * Reads `address.details` and `address.postal_code`, so the query must join
	 * `client_address.address` under the alias `address` first.
	 */
	filterByTerm(term?: string): this {
		if (term) {
			if (!Number.isNaN(Number(term)) && term.trim() !== '') {
				this.filterBy('id', Number(term));
			} else {
				if (term.length >= Configuration.get('filter.termMinLength')) {
					this.filterAny([
						{
							column: 'client_address.details',
							value: term,
							operator: 'ILIKE',
						},
						{
							column: 'address.details',
							value: term,
							operator: 'ILIKE',
						},
						{
							column: 'address.postal_code',
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

export const getClientAddressRepository = () =>
	dataSource.getRepository(ClientAddressEntity).extend({
		createQuery() {
			return new ClientAddressQuery(this);
		},
	});
