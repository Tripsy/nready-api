import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import { REFERENCE_PATTERN } from '@/features/order/order.repository';
import ShippingEntity from '@/features/shipping/shipping.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ShippingQuery extends RepositoryAbstract<ShippingEntity> {
	constructor(repository: Repository<ShippingEntity>) {
		super(repository, ShippingEntity.NAME);
	}

	/**
	 * The list's one search box, which also stands in for an order filter - the question this table
	 * is usually opened with is "where are the parcels for this order".
	 *
	 * - A bare number is read as the shipment id, the order id *or* the order's document number: the
	 *   three are indistinguishable to the person typing, and the wrong guess would return an empty
	 *   page. The cost is that one number can surface unrelated rows side by side.
	 * - A written reference (`ORD-1183`) matches the order through `IDX_order_ref`, but is also tried
	 *   against the tracking number, since carrier codes (`DPD12345678`) share the same shape.
	 * - Anything else searches the tracking number - the string a customer quotes when they ask
	 *   where their parcel is.
	 *
	 * Relies on the `order` join `findByFilter` makes; a relocation has no order and matches only on
	 * its own id and tracking number.
	 */
	filterByTerm(term?: string): this {
		const value = term?.trim();

		if (!value) {
			return this;
		}

		if (!Number.isNaN(Number(value))) {
			return this.filterAny([
				{ column: 'id', value: Number(value), operator: '=' },
				{ column: 'order.id', value: Number(value), operator: '=' },
				{
					column: 'order.ref_number',
					value: Number(value),
					operator: '=',
				},
			]);
		}

		if (value.length < Configuration.get('filter.termMinLength')) {
			return this;
		}

		const reference = REFERENCE_PATTERN.exec(value);

		if (reference) {
			return this.filterRaw(
				'((order.ref_code = :term_ref_code AND order.ref_number = :term_ref_number) OR shipping.tracking_number ILIKE :term_tracking)',
				{
					term_ref_code: reference[1].toUpperCase(),
					term_ref_number: Number(reference[2]),
					term_tracking: `%${value}%`,
				},
			);
		}

		return this.filterBy('tracking_number', value, 'ILIKE');
	}
}

export const getShippingRepository = () =>
	dataSource.getRepository(ShippingEntity).extend({
		createQuery() {
			return new ShippingQuery(this);
		},
	});
