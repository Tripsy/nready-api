import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
} from 'typeorm';
import type OrderEntity from '@/features/order/order.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'stock_reservation';

/**
 * Units promised to an order that has not shipped them yet - what separates stock on hand from
 * stock available to sell.
 *
 * **Not on the ledger.** Nothing physical moves when an order is placed, and `warehouse_movement`
 * records only facts; a promise lives here and is replaced as the order changes.
 *
 * **Per variant, not per warehouse.** An order does not know its warehouse until a delivery is
 * prepared, and one order may ship from two. So available is
 * `on hand across active warehouses - reserved by live orders`, per variant.
 *
 * **One row per (order, variant), following the order.** Placing or re-lining a pending order
 * replaces the order's set; a delivery shipping lowers it by what left (a returned one gives it
 * back); canceling or completing the order removes what is left. There is no `deleted_at`: a
 * soft-deleted order's rows are ignored by the availability query instead, which joins live
 * orders only, so deleting and restoring an order needs no handling here.
 *
 * Only variants with `track_stock` are reserved - a variant that tracks nothing (digital goods,
 * made to order) is never short.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Units promised to orders not yet shipped; available = on hand - reserved, per variant',
})
@Index('IDX_stock_reservation_unique', ['order_id', 'variant_id'], {
	unique: true,
})
@Check(`(quantity > 0)`)
export default class StockReservationEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@Column('uuid', { nullable: false })
	order_id!: EntityId;

	// The availability sum groups by it
	@Column('uuid', { nullable: false })
	@Index('IDX_stock_reservation_variant_id')
	variant_id!: EntityId;

	// `numeric` for the reason `order_line.quantity` is: a weighed product sells 0.75 kg
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	quantity!: number;

	// CASCADE: a reservation means nothing without the order that made it
	@ManyToOne('OrderEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'order_id' })
	order?: OrderEntity;

	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'variant_id' })
	variant?: ProductVariantEntity;
}
