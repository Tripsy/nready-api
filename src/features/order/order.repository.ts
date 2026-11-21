import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import OrderEntity from '@/features/order/order.entity';
import OrderLineEntity from '@/features/order/order-line.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/** `ORD-1183`, `ORD 1183`, `ord/1183` - how a reference is written down when it is not typed. */
export const REFERENCE_PATTERN = /^([a-z]{2,10})[\s\-/]?(\d{1,10})$/i;

export class OrderQuery extends RepositoryAbstract<OrderEntity> {
	constructor(repository: Repository<OrderEntity>) {
		super(repository, OrderEntity.NAME);
	}

	filterByClient(clientId?: EntityId | null): this {
		this.filterBy('client_id', clientId);

		return this;
	}

	/**
	 * The document reference as a person cites it - "ORD-1183". Both halves are needed: the number
	 * is only unique within its series, which is what `IDX_order_ref` is keyed on.
	 */
	filterByReference(code?: string | null, number?: number | null): this {
		this.filterBy('ref_code', code);
		this.filterBy('ref_number', number);

		return this;
	}

	/**
	 * The dashboard's one search box.
	 *
	 * An order has no name, so the things somebody searches by are its identifiers: the reference
	 * as printed (`ORD-1183`) or the bare document number. A whole reference is split and matched
	 * on both halves through `IDX_order_ref`; a bare number is read as `ref_number`.
	 */
	filterByTerm(term?: string): this {
		if (!term) {
			return this;
		}

		const value = term.trim();

		if (value === '') {
			return this;
		}

		const reference = REFERENCE_PATTERN.exec(value);

		if (reference) {
			return this.filterByReference(
				reference[1].toUpperCase(),
				Number(reference[2]),
			);
		}

		if (!Number.isNaN(Number(value))) {
			return this.filterBy('ref_number', Number(value));
		}

		if (value.length >= Configuration.get('filter.termMinLength')) {
			this.filterBy('ref_code', value, 'ILIKE');
		}

		return this;
	}
}

export class OrderLineQuery extends RepositoryAbstract<OrderLineEntity> {
	constructor(repository: Repository<OrderLineEntity>) {
		super(repository, OrderLineEntity.NAME);
	}
}

export const getOrderRepository = () =>
	dataSource.getRepository(OrderEntity).extend({
		createQuery() {
			return new OrderQuery(this);
		},
	});

export const getOrderLineRepository = () =>
	dataSource.getRepository(OrderLineEntity).extend({
		createQuery() {
			return new OrderLineQuery(this);
		},
	});
