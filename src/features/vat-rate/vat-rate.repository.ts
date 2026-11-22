import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import VatRateEntity from '@/features/vat-rate/vat-rate.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class VatRateQuery extends RepositoryAbstract<VatRateEntity> {
	constructor(repository: Repository<VatRateEntity>) {
		super(repository, VatRateEntity.NAME);
	}

	/**
	 * Rows that took effect on or before `day`. Ordered by `valid_from` descending, the first per
	 * category is the rate in force then.
	 */
	filterInForceBy(day?: string): this {
		this.filterBy('valid_from', day, '<=');

		return this;
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'country_code',
						value: term.trim().toUpperCase(),
						operator: 'ILIKE',
					},
					{
						column: 'notes',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getVatRateRepository = () =>
	dataSource.getRepository(VatRateEntity).extend({
		createQuery() {
			return new VatRateQuery(this);
		},
	});
