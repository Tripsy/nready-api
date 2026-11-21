import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import DiscountEntity from '@/features/discount/discount.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class DiscountQuery extends RepositoryAbstract<DiscountEntity> {
	constructor(repository: Repository<DiscountEntity>) {
		super(repository, DiscountEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'label',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'reference',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getDiscountRepository = () =>
	dataSource.getRepository(DiscountEntity).extend({
		createQuery() {
			return new DiscountQuery(this);
		},
	});
