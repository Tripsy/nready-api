import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type ClientEntity from '@/features/client/client.entity';
import type ClientAddressEntity from '@/features/client-address/client-address.entity';
import type OrderLineEntity from '@/features/order/order-line.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';

export const OrderStatusEnum = {
	PENDING: 'pending', // Placed - by a checkout or from the back office - and awaiting acceptance; lines may still be adjusted
	CONFIRMED: 'confirmed', // Accepted by the business; shipping may begin
	COMPLETED: 'completed', // Fulfilled and settled
	CANCELLED: 'canceled', // Withdrawn before fulfilment
} as const;

export type OrderStatus =
	(typeof OrderStatusEnum)[keyof typeof OrderStatusEnum];

/**
 * Allowed status transition configuration.
 *
 * The line runs one way: an order is placed, accepted, fulfilled. Every order enters at `pending`,
 * whether a checkout raised it or an operator typed it up, and `pending` is the one state whose
 * lines may still be adjusted - quantities corrected, a missing item added - before the business
 * accepts it. Nothing returns to `pending`: confirming is what fixes the contents, and reopening a
 * confirmed order would let them be edited out from under that acceptance.
 *
 * **`canceled` stays reachable from `confirmed`**, unlike `grn`, where confirming already moved
 * stock and cancelling has to post reversals. Confirming an order moves nothing: stock leaves on
 * the shipping transition, not here (see `shipping.entity.ts`, `warehouse_id`), so an order
 * canceled before it ships has nothing to undo. A shipment already under way is `shipping`'s
 * own status machine to resolve.
 *
 * **`completed` is terminal.** An order that goes wrong afterwards is corrected on the money, not
 * on the document - a credit note or a refund against the invoice, which `invoice` carries its own
 * statuses for. Cancelling a fulfilled order would leave goods delivered against a document
 * claiming they never were.
 */
export const STATUS_TRANSITIONS: StatusTransitions<OrderStatus> = {
	[OrderStatusEnum.PENDING]: [
		OrderStatusEnum.CONFIRMED,
		OrderStatusEnum.CANCELLED,
	],
	[OrderStatusEnum.CONFIRMED]: [
		OrderStatusEnum.COMPLETED,
		OrderStatusEnum.CANCELLED,
	],
	[OrderStatusEnum.COMPLETED]: [
		// Allow nothing
	],
	[OrderStatusEnum.CANCELLED]: [
		// Allow nothing
	],
};

export const OrderTypeEnum = {
	STANDARD: 'standard',
	SUBSCRIPTION: 'subscription',
} as const;

export type OrderType = (typeof OrderTypeEnum)[keyof typeof OrderTypeEnum];

/**
 * How the client said they will pay. Recorded as a choice only - nothing here charges, captures or
 * reconciles a payment; `cash_flow` and `invoice` carry the money once it moves.
 */
export const OrderPaymentMethodEnum = {
	CASH_ON_DELIVERY: 'cash_on_delivery',
	CARD: 'card',
	BANK_TRANSFER: 'bank_transfer',
} as const;

export type OrderPaymentMethod =
	(typeof OrderPaymentMethodEnum)[keyof typeof OrderPaymentMethodEnum];

const ENTITY_TABLE_NAME = 'order';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores order information',
})
// Series plus sequential number, matching `invoice` and `grn` - one numbering scheme across every
// document the business issues
@Index('IDX_order_ref', ['ref_code', 'ref_number'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class OrderEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_order_client_id')
	client_id!: number;

	@Column('varchar', {
		length: 10,
		nullable: false,
		comment: 'Series code allocated from document_series, e.g. ORD',
	})
	ref_code!: string;

	@Column('int', {
		nullable: false,
		comment: 'Sequential number within the series',
	})
	ref_number!: number;

	@Column({
		type: 'enum',
		enum: OrderStatusEnum,
		default: OrderStatusEnum.PENDING,
		nullable: false,
	})
	@Index('IDX_order_status')
	status!: OrderStatus;

	@Column({
		type: 'enum',
		enum: OrderTypeEnum,
		default: OrderTypeEnum.STANDARD,
		nullable: false,
	})
	type!: OrderType;

	/**
	 * Null on a back-office document: an operator composing an order by phone agrees goods and
	 * prices, and how it is settled is not always known at that point. A checkout always states one.
	 */
	@Column({
		type: 'enum',
		enum: OrderPaymentMethodEnum,
		nullable: true,
	})
	payment_method!: OrderPaymentMethod | null;

	/**
	 * Where the order is billed, named by reference rather than copied.
	 *
	 * Null on a back-office document raised before a billing address is agreed, and null again once
	 * that address is removed - the key is `SET NULL`, so deleting a client address stays possible
	 * and cannot take the order with it.
	 *
	 * The counterparty's own details are not duplicated here either; they are read through
	 * `client_id`. An invoice raised from the order is where they get frozen, into
	 * `invoice.billing_details` - the invoice is the document that has to keep saying who was
	 * billed whatever the client edits afterwards, and an order is still amendable.
	 */
	@Column('int', {
		nullable: true,
		comment: 'The client address the order is billed to',
	})
	@Index('IDX_order_billing_address_id')
	billing_address_id!: number | null;

	@Column({ type: 'timestamp', nullable: false })
	@Index('IDX_order_issued_at')
	issued_at!: Date;

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('ClientEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'client_id' })
	client!: ClientEntity;

	// SET NULL rather than RESTRICT: a client address is deleted outright, and an order placed
	// against it must not be what blocks the client from tidying their address book
	@ManyToOne('ClientAddressEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'billing_address_id' })
	billing_address?: ClientAddressEntity | null;

	@OneToMany(
		'OrderLineEntity',
		(orderLine: OrderLineEntity) => orderLine.order,
	)
	order_lines?: OrderLineEntity[];
}
