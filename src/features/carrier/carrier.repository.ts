import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import CarrierEntity from '@/features/carrier/carrier.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class CarrierQuery extends RepositoryAbstract<CarrierEntity> {
	constructor(repository: Repository<CarrierEntity>) {
		super(repository, CarrierEntity.NAME);
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
					{
						column: 'website',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getCarrierRepository = () =>
	dataSource.getRepository(CarrierEntity).extend({
		createQuery() {
			return new CarrierQuery(this);
		},
	});
