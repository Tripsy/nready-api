import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import VendorEntity from '@/features/vendor/vendor.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class VendorQuery extends RepositoryAbstract<VendorEntity> {
	constructor(repository: Repository<VendorEntity>) {
		super(repository, VendorEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'name',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getVendorRepository = () =>
	dataSource.getRepository(VendorEntity).extend({
		createQuery() {
			return new VendorQuery(this);
		},
	});
