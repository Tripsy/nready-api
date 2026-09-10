import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type ClientEntity from '@/features/client/client.entity';
import type OrderProductEntity from '@/features/order/order-product.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';

export const OrderStatusEnum = {
	DRAFT: 'draft', // Being composed in the back office; the customer has not committed
	PENDING: 'pending', // Placed and awaiting acceptance
	CONFIRMED: 'confirmed', // Accepted by the business; shipping may begin
	COMPLETED: 'completed', // Fulfilled and settled
	CANCELLED: 'canceled', // Withdrawn before fulfilment
} as const;

export type OrderStatus =
	(typeof OrderStatusEnum)[keyof typeof OrderStatusEnum];

/**
 * Allowed status transition configuration.
 *
 * The line runs one way: an order is composed, placed, accepted, fulfilled. Nothing returns to
 * `draft` - that state is defined by the customer not having committed yet, and a cart checkout
 * enters at `pending` precisely because they have. Reopening a placed order as a draft would let
 * its contents be edited out from under what they agreed to.
 *
 * **`canceled` stays reachable from `confirmed`**, unlike `grn`, where confirming already moved
 * stock and cancelling has to post reversals. Confirming an order moves nothing: stock leaves on
 * the shipping transition, not here (see `order-shipping.entity.ts`, `warehouse_id`), so an order
 * canceled before it ships has nothing to undo. A shipment already under way is `order_shipping`'s
 * own status machine to resolve.
 *
 * **`completed` is terminal.** An order that goes wrong afterwards is corrected on the money, not
 * on the document - a credit note or a refund against the invoice, which `invoice` carries its own
 * statuses for. Cancelling a fulfilled order would leave goods delivered against a document
 * claiming they never were.
 */
export const STATUS_TRANSITIONS: StatusTransitions<OrderStatus> = {
	[OrderStatusEnum.DRAFT]: [
		OrderStatusEnum.PENDING,
		OrderStatusEnum.CANCELLED,
	],
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
		default: OrderStatusEnum.DRAFT,
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

	@OneToMany(
		'OrderProductEntity',
		(orderProduct: OrderProductEntity) => orderProduct.order,
	)
	order_products?: OrderProductEntity[];
}
