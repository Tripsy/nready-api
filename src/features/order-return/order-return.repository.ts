import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import OrderReturnEntity from '@/features/order-return/order-return.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

/** A written return reference - `RMA-12` / `rma 12`. The shape `grn.repository.ts` reads. */
const REFERENCE_PATTERN = /^([a-z]{2,10})[\s\-/]?(\d{1,10})$/i;

export class OrderReturnQuery extends RepositoryAbstract<OrderReturnEntity> {
	constructor(repository: Repository<OrderReturnEntity>) {
		super(repository, OrderReturnEntity.NAME);
	}

	/**
	 * The list's one search box: a bare number is the return's number in its series, a
	 * written reference (`RMA-12`) matches through `IDX_order_return_ref`. Nothing else is
	 * searchable - the text on a return is the buyer's and is not worth an index.
	 */
	filterByTerm(term?: string): this {
		const value = term?.trim();

		if (!value) {
			return this;
		}

		if (!Number.isNaN(Number(value))) {
			return this.filterBy('ref_number', Number(value));
		}

		if (value.length < Configuration.get('filter.termMinLength')) {
			return this;
		}

		const reference = REFERENCE_PATTERN.exec(value);

		if (!reference) {
			return this;
		}

		return this.filterRaw(
			'(order_return.ref_code = :term_ref_code AND order_return.ref_number = :term_ref_number)',
			{
				term_ref_code: reference[1].toUpperCase(),
				term_ref_number: Number(reference[2]),
			},
		);
	}
}

export const getOrderReturnRepository = () =>
	dataSource.getRepository(OrderReturnEntity).extend({
		createQuery() {
			return new OrderReturnQuery(this);
		},
	});
