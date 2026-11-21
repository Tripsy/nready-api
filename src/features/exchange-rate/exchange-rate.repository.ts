import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import ExchangeRateEntity from '@/features/exchange-rate/exchange-rate.entity';
import { normalizeCurrency } from '@/helpers/shop.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ExchangeRateQuery extends RepositoryAbstract<ExchangeRateEntity> {
	constructor(repository: Repository<ExchangeRateEntity>) {
		super(repository, ExchangeRateEntity.NAME);
	}

	/**
	 * The priced currency and what it is priced in. Directional - a row saying what one EUR is
	 * worth in RON is not matched by asking what one RON is worth in EUR.
	 */
	filterByCurrency(currency?: string, baseCurrency?: string): this {
		this.filterBy('currency', currency);
		this.filterBy('base_currency', baseCurrency);

		return this;
	}

	/**
	 * Rows published on or before `date`. Ordered by `rate_date` descending, the first is the
	 * rate that was in force then - a day with no publication (a weekend, a holiday) carries
	 * the previous one forward rather than having no rate at all.
	 */
	filterAsOf(date?: string): this {
		this.filterBy('rate_date', date, '<=');

		return this;
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				// A currency code is exactly three characters, so a term that is one
				// matches a whole column rather than a fragment of it
				this.filterAny([
					{
						column: 'currency',
						value: normalizeCurrency(term),
						operator: 'ILIKE',
					},
					{
						column: 'base_currency',
						value: normalizeCurrency(term),
						operator: 'ILIKE',
					},
					{
						column: 'provider',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getExchangeRateRepository = () =>
	dataSource.getRepository(ExchangeRateEntity).extend({
		createQuery() {
			return new ExchangeRateQuery(this);
		},
	});
