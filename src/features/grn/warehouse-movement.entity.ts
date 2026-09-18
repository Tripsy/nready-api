import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type GrnItemEntity from '@/features/grn/grn-item.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import type WarehouseEntity from '@/features/warehouse/warehouse.entity';
import { EntityAppendOnlyAbstract } from '@/shared/abstracts/entity-append-only.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

export const WarehouseMovementTypeEnum = {
	RECEIPT: 'receipt', // A GRN confirmed
	SALE: 'sale', // Goods left against a shipment
	SALE_RETURN: 'sale_return', // A customer sent them back
	SUPPLIER_RETURN: 'supplier_return', // Sent back to the vendor
	ADJUSTMENT: 'adjustment', // A count found more or fewer than recorded
	WRITE_OFF: 'write_off', // Damaged, expired or lost
	TRANSFER_IN: 'transfer_in',
	TRANSFER_OUT: 'transfer_out',
} as const;

export type WarehouseMovementType =
	(typeof WarehouseMovementTypeEnum)[keyof typeof WarehouseMovementTypeEnum];

export const WarehouseMovementSourceEnum = {
	GRN_ITEM: 'grn_item',
	SHIPPING_LINE: 'shipping_line',
	ADJUSTMENT: 'adjustment', // Entered by hand, no document behind it
} as const;

export type WarehouseMovementSource =
	(typeof WarehouseMovementSourceEnum)[keyof typeof WarehouseMovementSourceEnum];

const ENTITY_TABLE_NAME = 'warehouse_movement';

/**
 * The append-only ledger of every physical stock change.
 *
 * **Rows are never updated and never deleted.** It extends `EntityAppendOnlyAbstract` rather than
 * `EntityAbstract` so there is no `deleted_at` to soft-delete into and no `updated_at` to invite an
 * edit - the guarantee is structural, not a comment. A mistake is corrected by posting an opposing
 * row with `reversal_of_id` set.
 *
 * It is the audit trail, not the balance: on-hand comes from `grn_item.qty_remaining`, and a
 * reconciliation job compares the sum of movements per lot against it and reports drift.
 *
 * **Stock leaves on shipment, not on order confirmation.** The source of an outbound sale is an
 * `shipping_line`, because a lot cannot be picked before the warehouse shipping it is
 * known - and one order may ship from two. `order_line` carries no lot reference at all.
 *
 * Reservations are deliberately absent. Nothing physical moves when an order is placed, and a
 * ledger that mixes promises with facts stops being either.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Append-only ledger of physical stock changes; corrections are reversing rows, never edits',
})
// The reconciliation scan, and any "what happened to this variant here" history
@Index('IDX_warehouse_movement_variant', [
	'warehouse_id',
	'variant_id',
	'occurred_at',
])
@Index('IDX_warehouse_movement_grn_item_id', ['grn_item_id'])
// Answers "which movements did this shipment line cause", the way `operational_record` indexes its
// polymorphic pair
@Index('IDX_warehouse_movement_source', ['source_type', 'source_id'])
// A movement may be canceled once. Without this a second reversal double-counts, and the
// reconciliation job cannot see it: if `qty_remaining` was adjusted twice too, both sides agree
// and are both wrong
@Index('IDX_warehouse_movement_reversal_of_id', ['reversal_of_id'], {
	unique: true,
	where: 'reversal_of_id IS NOT NULL',
})
@Check(`(qty <> 0)`)
// Direction has to agree with the reason, the way `cash_flow` checks its direction against its
// category. Nothing else stops a `receipt` that removes stock.
// `adjustment` is exempt on purpose: a stock count legitimately finds more or fewer than recorded,
// so it is the one type whose sign carries information rather than being implied by the reason
@Check(`
	(
		(movement_type IN ('receipt', 'sale_return', 'transfer_in') AND qty > 0)
		OR
		(movement_type IN ('sale', 'supplier_return', 'write_off', 'transfer_out') AND qty < 0)
		OR
		movement_type = 'adjustment'
	)
`)
export default class WarehouseMovementEntity extends EntityAppendOnlyAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({
		type: 'enum',
		enum: WarehouseMovementTypeEnum,
		nullable: false,
	})
	@Index('IDX_warehouse_movement_type')
	movement_type!: WarehouseMovementType;

	// Signed: positive brings stock in, negative takes it out. One number rather than a direction
	// enum plus a magnitude, so a balance is a SUM and cannot disagree with itself
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment: 'Signed quantity; positive is inbound, negative is outbound',
	})
	qty!: number;

	@Column('decimal', {
		precision: 12,
		scale: 4,
		nullable: false,
		comment:
			'Cost recognised per unit, in base currency, taken from the lot',
		transformer: numericTransformer,
	})
	unit_cost_base!: number;

	@Column({
		type: 'enum',
		enum: WarehouseMovementSourceEnum,
		nullable: false,
	})
	source_type!: WarehouseMovementSource;

	@Column('int', {
		nullable: true,
		comment:
			'Row in the table named by source_type; no FK, the target varies',
	})
	source_id!: number | null;

	@Column({
		type: 'timestamp',
		nullable: false,
		comment: 'When the stock physically moved',
	})
	occurred_at!: Date;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@Column('int', { nullable: false })
	warehouse_id!: number;

	@Column('int', { nullable: false })
	variant_id!: number;

	// Nullable only for movements that touch no particular lot; every FIFO consumption names one
	@Column('int', { nullable: true })
	grn_item_id!: number | null;

	@Column('int', {
		nullable: true,
		comment: 'The movement this one cancels out',
	})
	reversal_of_id!: number | null;

	@ManyToOne('WarehouseEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'warehouse_id' })
	warehouse!: WarehouseEntity;

	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'variant_id' })
	variant!: ProductVariantEntity;

	@ManyToOne('GrnItemEntity', {
		onDelete: 'RESTRICT',
		nullable: true,
	})
	@JoinColumn({ name: 'grn_item_id' })
	grn_item?: GrnItemEntity | null;

	@ManyToOne('WarehouseMovementEntity', {
		onDelete: 'RESTRICT',
		nullable: true,
	})
	@JoinColumn({ name: 'reversal_of_id' })
	reversal_of?: WarehouseMovementEntity | null;
}
