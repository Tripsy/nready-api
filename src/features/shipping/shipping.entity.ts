import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { AddressSnapshot } from '@/features/address/address.entity';
import type CarrierEntity from '@/features/carrier/carrier.entity';
import type ClientAddressEntity from '@/features/client-address/client-address.entity';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import type OrderEntity from '@/features/order/order.entity';
import type WarehouseEntity from '@/features/warehouse/warehouse.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { StatusTransitions } from '@/shared/types/common.type';

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
 * Allowed status transition configuration.
 *
 * A consignment is prepared, handed over, and arrives - and `failed` is reachable from each of those
 * because it can go wrong at any of them: nothing picked, nothing collected, nothing delivered.
 *
 * **`shipped` is where the two ends stop being editable**: the transition into it freezes
 * `pickup_data` and `destination_data`, since re-addressing goods already with the carrier would
 * make the document disagree with where they physically went.
 *
 * `returned` is reachable only from `shipped` - goods have to have left before they can come back,
 * and once they have arrived the delivery is what happened. **`delivered` is terminal**, like
 * `failed` and `returned`: goods that arrive and are later sent back are the return leg of a
 * different movement, which is its own `return` row, not this one reopened.
 */
export const STATUS_TRANSITIONS: StatusTransitions<ShippingStatus> = {
	[ShippingStatusEnum.PENDING]: [
		ShippingStatusEnum.PREPARING,
		ShippingStatusEnum.FAILED,
	],
	[ShippingStatusEnum.PREPARING]: [
		ShippingStatusEnum.SHIPPED,
		ShippingStatusEnum.FAILED,
	],
	[ShippingStatusEnum.SHIPPED]: [
		ShippingStatusEnum.DELIVERED,
		ShippingStatusEnum.RETURNED,
		ShippingStatusEnum.FAILED,
	],
	[ShippingStatusEnum.DELIVERED]: [
		// Allow nothing
	],
	[ShippingStatusEnum.FAILED]: [
		// Allow nothing
	],
	[ShippingStatusEnum.RETURNED]: [
		// Allow nothing
	],
};

/**
 * What kind of movement this is, and therefore what each end of it names.
 *
 * | scope | pickup | destination | document |
 * |---|---|---|---|
 * | `delivery` | warehouse | client address | `order_id` |
 * | `relocation` | warehouse | warehouse | `document_ref` |
 * | `return` | client address | warehouse | `order_id` |
 *
 * **The scope is fixed once the row exists.** Changing it would re-point both ends at other tables
 * while the allocation, the frozen snapshots and any stock movement already posted still describe
 * the old shape - so a movement of a different kind is a new row, not an edited one.
 */
export const ShippingScopeEnum = {
	DELIVERY: 'delivery',
	RELOCATION: 'relocation',
	RETURN: 'return',
} as const;

export type ShippingScope =
	(typeof ShippingScopeEnum)[keyof typeof ShippingScopeEnum];

/**
 * A flattened address as a shipped row freezes it. Either end may be a warehouse or a client
 * address, and both flatten to the same columns, so one shape serves both.
 */
export type ShippingAddressSnapshot = AddressSnapshot;

/**
 * How the goods travel. `self_pickup` still names a warehouse - the one they are collected from -
 * so the row is written for both and stock leaves through the same transition either way.
 */
export const ShippingMethodEnum = {
	SELF_PICKUP: 'self_pickup',
	COURIER: 'courier',
} as const;

export type ShippingMethod =
	(typeof ShippingMethodEnum)[keyof typeof ShippingMethodEnum];

const ENTITY_TABLE_NAME = 'shipping';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Physical movements of goods: deliveries to a client, relocations between warehouses, and returns',
})
/*
 * Each scope forbids the two columns that belong to the other shapes, rather than requiring its own
 * two to be present.
 *
 * That asymmetry is deliberate and is forced by the keys: the client-address columns are
 * `ON DELETE SET NULL`, so a constraint demanding one be present would turn "delete this address"
 * into a constraint violation instead of nulling the reference. Presence is therefore enforced by
 * `ShippingService` when the row is written, and the database guarantees only that a row never
 * names an end its scope has no use for.
 */
@Check(`
	(
		(scope = 'delivery' AND pickup_client_address_id IS NULL AND destination_warehouse_id IS NULL)
		OR
		(scope = 'relocation' AND pickup_client_address_id IS NULL AND destination_client_address_id IS NULL)
		OR
		(scope = 'return' AND pickup_warehouse_id IS NULL AND destination_client_address_id IS NULL)
	)
`)
// The document each scope answers to. An order is a real foreign key; the relocation document has
// no table yet, so it is carried as a bare id and the two are kept from being set at once
@Check(`
	(
		(scope IN ('delivery', 'return') AND document_ref IS NULL)
		OR
		(scope = 'relocation' AND order_id IS NULL)
	)
`)
export default class ShippingEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	/**
	 * Which of the three movements this is - and so which table each end points at. Write-once; see
	 * `ShippingScopeEnum`.
	 */
	@Column({
		type: 'enum',
		enum: ShippingScopeEnum,
		nullable: false,
	})
	@Index('IDX_shipping_scope')
	scope!: ShippingScope;

	/**
	 * The order this movement serves, on a `delivery` or a `return`. Null on a `relocation`, which
	 * answers to `document_ref` instead.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_shipping_order_id')
	order_id!: number | null;

	/**
	 * The document behind a `relocation`, which has no table in the system yet - so this is a bare
	 * id with no foreign key behind it, and nothing reads through it until that feature exists.
	 *
	 * Null for `delivery` and `return`, whose document is the order above.
	 */
	@Column('int', {
		nullable: true,
		comment:
			'Id of the relocation document; no table for it yet, so no key',
	})
	@Index('IDX_shipping_document_ref')
	document_ref!: number | null;

	@Column({
		type: 'enum',
		enum: ShippingStatusEnum,
		default: ShippingStatusEnum.PENDING,
		nullable: false,
	})
	@Index('IDX_shipping_status')
	status!: ShippingStatus;

	@Column({
		type: 'enum',
		enum: ShippingMethodEnum,
		nullable: false,
	})
	@Index('IDX_shipping_method')
	method!: ShippingMethod;

	@Column('int', { nullable: true })
	@Index('IDX_shipping_carrier_id')
	carrier_id!: number | null;

	// PICKUP - where the goods leave from
	/**
	 * The site goods are picked from, on a `delivery` or a `relocation`.
	 *
	 * Set per movement rather than per order, so one order can ship from two sites. It is also what
	 * makes FIFO possible: a lot cannot be chosen before the warehouse holding it is known, which is
	 * why stock leaves on the shipping transition rather than on order confirmation.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_shipping_pickup_warehouse_id')
	pickup_warehouse_id!: number | null;

	/** Where a `return` is collected from - the client's own address. */
	@Column('int', { nullable: true })
	@Index('IDX_shipping_pickup_client_address_id')
	pickup_client_address_id!: number | null;

	// DESTINATION - where they are going
	/** Where a `relocation` or a `return` lands. */
	@Column('int', { nullable: true })
	@Index('IDX_shipping_destination_warehouse_id')
	destination_warehouse_id!: number | null;

	/** Where a `delivery` lands - the client's own address. */
	@Column('int', { nullable: true })
	@Index('IDX_shipping_destination_client_address_id')
	destination_client_address_id!: number | null;

	/**
	 * Both ends as they stood when the goods left, written by the transition into `shipped`.
	 *
	 * Null before that: while a movement is still being prepared, the live reference is the better
	 * answer - an address corrected before dispatch should reach the goods. Once they are with the
	 * carrier the opposite holds, and these are what a later edit or deletion cannot reach.
	 */
	@Column('jsonb', {
		nullable: true,
		comment: 'Origin address frozen when the movement was marked shipped',
	})
	pickup_data!: ShippingAddressSnapshot | null;

	@Column('jsonb', {
		nullable: true,
		comment:
			'Destination address frozen when the movement was marked shipped',
	})
	destination_data!: ShippingAddressSnapshot | null;

	@Column('varchar', { nullable: true })
	@Index('IDX_shipping_tracking_number', {
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

	/**
	 * What the movement cost the business to carry out - the carrier's invoice, packaging, a
	 * courier booked by hand. Entered by the back office once it is known, so it is null until then
	 * rather than zero: zero is a real figure (a self-pickup), null is one nobody has recorded yet,
	 * and a margin computed over the two would read the same.
	 *
	 * In the base currency (`app.currency`), like `product_variant.cost_price` - the books are kept
	 * in one currency, while `price` above is in the client's `currency` and reaches the base one
	 * through `exchange_rate`.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: true,
		comment: 'Internal cost of the movement, in base currency',
		transformer: numericTransformer,
	})
	operational_cost!: number | null;

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

	/**
	 * The `shipping`-scope discount that reduced `price`, when one did. One snapshot at most: a
	 * shipment has a single price and the best rule wins outright, but the column keeps the array
	 * shape `order_line.discount` has so a reader handles both the same way.
	 */
	@Column('jsonb', {
		nullable: true,
		comment: 'Array of discount snapshots applied',
	})
	discount?: DiscountSnapshot[] | null;

	/**
	 * What the discount took off `price`, excluding VAT, in `currency` - the snapshot's `reduction`,
	 * stored as a figure of its own for the reason `order_line.discount_reduction` is: it is what VAT
	 * is charged after, so what the client pays is `(price - discount_reduction) x (1 + vat_rate)`.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Money off the price, excluding VAT, in the shipment currency',
		transformer: numericTransformer,
	})
	discount_reduction!: number;

	// CONTACT DETAILS
	@Column('varchar', { nullable: true })
	contact_name!: string | null;

	@Column('varchar', { nullable: true })
	contact_phone!: string | null;

	@Column('varchar', { nullable: true })
	contact_email!: string | null;

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
	order?: OrderEntity | null;

	@ManyToOne('CarrierEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'carrier_id' })
	carrier?: CarrierEntity | null;

	// RESTRICT on both warehouse ends: the row is the record of where goods physically left from or
	// landed, and losing that would orphan the stock movements it caused
	@ManyToOne('WarehouseEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'pickup_warehouse_id' })
	pickup_warehouse?: WarehouseEntity | null;

	@ManyToOne('WarehouseEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'destination_warehouse_id' })
	destination_warehouse?: WarehouseEntity | null;

	// SET NULL on both client-address ends, unlike the warehouses: an address book entry is the
	// client's own to remove, and the frozen snapshots already hold what a shipped row needs
	@ManyToOne('ClientAddressEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'pickup_client_address_id' })
	pickup_client_address?: ClientAddressEntity | null;

	@ManyToOne('ClientAddressEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'destination_client_address_id' })
	destination_client_address?: ClientAddressEntity | null;
}
