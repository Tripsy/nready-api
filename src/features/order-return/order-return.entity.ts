import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type OrderEntity from '@/features/order/order.entity';
import type OrderReturnLineEntity from '@/features/order-return/order-return-line.entity';
import type ShippingEntity from '@/features/shipping/shipping.entity';
import type UserEntity from '@/features/user/user.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';

export const OrderReturnStatusEnum = {
	REQUESTED: 'requested', // Asked for - by the buyer or by an operator on their behalf; nothing has moved
	APPROVED: 'approved', // Accepted; a `return` shipping movement carries the goods back
	REJECTED: 'rejected', // Refused; `response` says why
	RECEIVED: 'received', // The return movement reached its warehouse; stock is in and a refund drafted
	CLOSED: 'closed', // Settled by the operator - the refund issued, or decided against
	CANCELED: 'canceled', // Withdrawn before the goods came back
} as const;

export type OrderReturnStatus =
	(typeof OrderReturnStatusEnum)[keyof typeof OrderReturnStatusEnum];

/**
 * Allowed status transition configuration.
 *
 * `approved` and `received` are not moves an operator makes through the status route: approving
 * writes the return movement, so it takes a body of its own (`OrderReturnService.approve`), and
 * `received` is the return movement arriving (`shipping.hooks.ts` -> `notifyReturnReceived`). The
 * route offers the rest - see `MANUAL_STATUSES`.
 *
 * **`canceled` is open until the goods arrive.** An approved return can still be withdrawn while
 * its movement has not left the client; once it is on its way the movement decides what happens.
 */
export const STATUS_TRANSITIONS: StatusTransitions<OrderReturnStatus> = {
	[OrderReturnStatusEnum.REQUESTED]: [
		OrderReturnStatusEnum.APPROVED,
		OrderReturnStatusEnum.REJECTED,
		OrderReturnStatusEnum.CANCELED,
	],
	[OrderReturnStatusEnum.APPROVED]: [
		OrderReturnStatusEnum.RECEIVED,
		OrderReturnStatusEnum.CANCELED,
	],
	[OrderReturnStatusEnum.RECEIVED]: [OrderReturnStatusEnum.CLOSED],
	[OrderReturnStatusEnum.REJECTED]: [
		// Allow nothing
	],
	[OrderReturnStatusEnum.CLOSED]: [
		// Allow nothing
	],
	[OrderReturnStatusEnum.CANCELED]: [
		// Allow nothing
	],
};

/** The moves `PATCH /order-returns/:id/status/:status` takes; the other two have their own path. */
export const MANUAL_STATUSES = [
	OrderReturnStatusEnum.REJECTED,
	OrderReturnStatusEnum.CANCELED,
	OrderReturnStatusEnum.CLOSED,
] as const;

/** Statuses whose lines still claim the order's delivered goods. */
export const LIVE_STATUSES: readonly OrderReturnStatus[] = [
	OrderReturnStatusEnum.REQUESTED,
	OrderReturnStatusEnum.APPROVED,
	OrderReturnStatusEnum.RECEIVED,
	OrderReturnStatusEnum.CLOSED,
];

export const OrderReturnReasonEnum = {
	DAMAGED: 'damaged', // Arrived broken
	DEFECTIVE: 'defective', // Does not work
	WRONG_ITEM: 'wrong_item', // Not what was ordered
	NOT_AS_DESCRIBED: 'not_as_described',
	NO_LONGER_NEEDED: 'no_longer_needed', // Change of mind, within the withdrawal window
	OTHER: 'other',
} as const;

export type OrderReturnReason =
	(typeof OrderReturnReasonEnum)[keyof typeof OrderReturnReasonEnum];

const ENTITY_TABLE_NAME = 'order_return';

/**
 * A return merchandise authorization - the document a buyer's "send it back" request lives on.
 *
 * It carries the request and the decision; **the goods and the money move on the documents that
 * already know how**:
 *
 * - Approving writes a `return` `shipping` movement (`shipping_id`) - the physical leg, with its
 *   own lifecycle, its allocation cap (returned <= delivered) and the per-line `condition` the
 *   warehouse records on arrival. Receiving it is what puts the goods back in stock.
 * - Arriving drafts quantity reversals of the order's issued invoices (`reversal_invoice_ids`). An
 *   operator issues them, and issuing is what refunds what was paid (`rules/settlement.md`).
 *
 * `reversal_invoice_ids` is an id list rather than a key: a returned order can hold several issued
 * documents, so one return can draft several reversals, and a join table would carry nothing but
 * the pair. No foreign key can stand behind an array - an invoice is never hard-deleted, and a
 * draft reversal canceled since is still a row, so the ids keep resolving.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Return authorizations: a request to send goods back, and the decision on it',
})
@Index('IDX_order_return_ref', ['ref_code', 'ref_number'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
// The order's returns, and the claim the live ones hold on its delivered goods
@Index('IDX_order_return_order_status', ['order_id', 'status'])
// The dashboard queue - most rows leave `requested` and stay out of it
@Index('IDX_order_return_status', ['status'])
// One return document per movement: receiving the movement resolves exactly one document
@Index('IDX_order_return_shipping_id', ['shipping_id'], {
	unique: true,
	where: 'shipping_id IS NOT NULL AND deleted_at IS NULL',
})
export default class OrderReturnEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('varchar', {
		length: 10,
		nullable: false,
		comment: 'Series code allocated from document_series, e.g. RMA',
	})
	ref_code!: string;

	@Column('int', {
		nullable: false,
		comment: 'Sequential number within the series',
	})
	ref_number!: number;

	@Column({
		type: 'enum',
		enum: OrderReturnStatusEnum,
		default: OrderReturnStatusEnum.REQUESTED,
		nullable: false,
	})
	status!: OrderReturnStatus;

	@Column({
		type: 'enum',
		enum: OrderReturnReasonEnum,
		nullable: false,
	})
	reason!: OrderReturnReason;

	@Column('text', {
		nullable: true,
		comment: 'What the buyer wrote with the request',
	})
	customer_notes!: string | null;

	@Column('text', {
		nullable: true,
		comment: 'What the buyer is told about the decision',
	})
	response!: string | null;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'When it was approved or rejected',
	})
	decided_at!: Date | null;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'When the return movement reached its warehouse',
	})
	received_at!: Date | null;

	@Column({
		type: 'timestamp',
		nullable: true,
	})
	closed_at!: Date | null;

	@Column('int', {
		array: true,
		nullable: false,
		default: () => "'{}'",
		comment:
			'Draft reversals raised for the returned goods; no FK, an array cannot carry one',
	})
	reversal_invoice_ids!: number[];

	// OTHER
	@Column('text', {
		nullable: true,
		comment: 'Internal, never shown to the buyer',
	})
	notes!: string | null;

	// RELATIONS
	@Column('int', { nullable: false })
	order_id!: number;

	@Column('int', {
		nullable: true,
		comment: 'The return movement, once approved',
	})
	shipping_id!: number | null;

	@Column('int', {
		nullable: true,
		comment: 'The account that asked; null when raised in the back office',
	})
	@Index('IDX_order_return_user_id')
	user_id!: number | null;

	@ManyToOne('OrderEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'order_id' })
	order!: OrderEntity;

	// RESTRICT: the movement is what put the goods back in stock, and the document has to keep
	// pointing at it
	@ManyToOne('ShippingEntity', {
		onDelete: 'RESTRICT',
		nullable: true,
	})
	@JoinColumn({ name: 'shipping_id' })
	shipping?: ShippingEntity | null;

	@ManyToOne('UserEntity', {
		onDelete: 'SET NULL',
		nullable: true,
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity | null;

	@OneToMany(
		'OrderReturnLineEntity',
		(line: OrderReturnLineEntity) => line.order_return,
	)
	lines?: OrderReturnLineEntity[];
}
