import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type CarrierEntity from '@/features/carrier/carrier.entity';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import type OrderEntity from '@/features/order/order.entity';
import type WarehouseEntity from '@/features/warehouse/warehouse.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

export const ShippingStatusEnum = {
	PENDING: 'pending',
	PREPARING: 'preparing',
	SHIPPED: 'shipped',
	DELIVERED: 'delivered',
	FAILED: 'failed',
	RETURNED: 'returned',
} as const;

export type ShippingStatus =
	(typeof ShippingStatusEnum)[keyof typeof ShippingStatusEnum];

/**
 * How the goods reach the client. `self_pickup` still names a warehouse - the one the client
 * collects from - so the shipment row is written for both and stock leaves through the same
 * transition either way.
 */
export const ShippingMethodEnum = {
	SELF_PICKUP: 'self_pickup',
	COURIER: 'courier',
} as const;

export type ShippingMethod =
	(typeof ShippingMethodEnum)[keyof typeof ShippingMethodEnum];

const ENTITY_TABLE_NAME = 'order_shipping';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores shipping details for orders',
})
export default class OrderShippingEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_order_shipping_order_id')
	order_id!: number;

	@Column({
		type: 'enum',
		enum: ShippingStatusEnum,
		default: ShippingStatusEnum.PENDING,
		nullable: false,
	})
	@Index('IDX_order_shipping_status')
	status!: ShippingStatus;

	@Column({
		type: 'enum',
		enum: ShippingMethodEnum,
		nullable: false,
	})
	@Index('IDX_order_shipping_method')
	method!: ShippingMethod;

	@Column('int', { nullable: true })
	@Index('IDX_order_shipping_carrier_id')
	carrier_id!: number | null;

	/**
	 * Where the goods are picked from - the origin, as opposed to the address snapshot below, which
	 * is the destination.
	 *
	 * Set per shipment rather than per order, so one order can ship from two warehouses. It is also
	 * what makes FIFO possible: a lot cannot be chosen before the warehouse holding it is known,
	 * which is why stock leaves on the shipping transition rather than on order confirmation.
	 *
	 * Required, because everything physically shipped leaves from somewhere - a restaurant's
	 * kitchen is a warehouse in every sense this column cares about. `warehouse.is_default` covers
	 * the single-site case so nothing has to be chosen by hand.
	 */
	@Column('int', { nullable: false })
	@Index('IDX_order_shipping_warehouse_id')
	warehouse_id!: number;

	@Column('varchar', { nullable: true })
	@Index('IDX_order_shipping_tracking_number', {
		unique: true,
		where: 'deleted_at IS NULL',
	})
	tracking_number!: string | null;

	@Column('varchar', { nullable: true })
	tracking_url!: string | null;

	// COST RELATED
	@Column('decimal', {
		precision: 5,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	vat_rate!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	price!: number;

	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
		comment: 'Currency is specific to client',
	})
	currency!: string;

	@Column('decimal', {
		precision: 10,
		scale: 6,
		nullable: false,
		default: 1,
		comment:
			'Exchange rate to invoice base currency (default 1 = same currency)',
		transformer: numericTransformer,
	})
	exchange_rate!: number;

	@Column('jsonb', {
		nullable: true,
		comment: 'Array of discount snapshots applied',
	})
	discount?: DiscountSnapshot[];

	// CONTACT DETAILS
	@Column('varchar', { nullable: true })
	contact_name!: string | null;

	@Column('varchar', { nullable: true })
	contact_phone!: string | null;

	@Column('varchar', { nullable: true })
	contact_email!: string | null;

	// ADDRESS SNAPSHOT
	@Column('varchar', { nullable: true })
	address_country!: string | null;

	@Column('varchar', { nullable: true })
	address_region!: string | null;

	@Column('varchar', { nullable: true })
	address_city!: string | null;

	@Column('varchar', { nullable: true })
	details!: string | null;

	@Column('varchar', { nullable: true })
	postal_code!: string | null;

	// DATES
	@Column({ type: 'timestamp', nullable: true })
	shipped_at!: Date | null;

	@Column({ type: 'timestamp', nullable: true })
	delivered_at!: Date | null;

	@Column({ type: 'timestamp', nullable: true })
	estimated_delivery_at!: Date | null;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('OrderEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'order_id' })
	order!: OrderEntity;

	@ManyToOne('CarrierEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'carrier_id' })
	carrier?: CarrierEntity | null;

	// RESTRICT: the shipment is the record of where goods physically left from, and losing that
	// would orphan the stock movements it caused
	@ManyToOne('WarehouseEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'warehouse_id' })
	warehouse!: WarehouseEntity;
}
