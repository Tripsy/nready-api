import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import BrandEntity from '@/features/brand/brand.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class BrandQuery extends RepositoryAbstract<BrandEntity> {
	constructor(repository: Repository<BrandEntity>) {
		super(repository, BrandEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'brand.name',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'content.description',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getBrandRepository = () =>
	dataSource.getRepository(BrandEntity).extend({
		createQuery() {
			return new BrandQuery(this);
		},
	});
