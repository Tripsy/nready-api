import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import type WarehouseEntity from '@/features/warehouse/warehouse.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { StatusTransitions } from '@/shared/types/common.type';

/** Which way the units go - into the warehouse's lots or out of them. */
export const StockAdjustmentDirectionEnum = {
	ADD: 'add',
	REMOVE: 'remove',
} as const;

export type StockAdjustmentDirection =
	(typeof StockAdjustmentDirectionEnum)[keyof typeof StockAdjustmentDirectionEnum];

export const StockAdjustmentReasonEnum = {
	// Either way - a shelf count disagreed with the books
	AUDIT: 'audit',
	// Out - goods gone without a sale
	DAMAGED: 'damaged',
	EXPIRED: 'expired',
	LOST: 'lost',
	THEFT: 'theft',
	SAMPLE: 'sample',
	// In - goods back without a document that brings them
	FOUND: 'found',
	SAMPLE_RETURNED: 'sample_returned',
	RETURN: 'return',
} as const;

export type StockAdjustmentReason =
	(typeof StockAdjustmentReasonEnum)[keyof typeof StockAdjustmentReasonEnum];

/**
 * The reasons each direction admits. `audit` is the one in both: a count finds more or fewer.
 * The database check below restates both lists - keep them in step.
 */
export const STOCK_ADJUSTMENT_REASONS: Record<
	StockAdjustmentDirection,
	readonly StockAdjustmentReason[]
> = {
	[StockAdjustmentDirectionEnum.REMOVE]: [
		StockAdjustmentReasonEnum.AUDIT,
		StockAdjustmentReasonEnum.DAMAGED,
		StockAdjustmentReasonEnum.EXPIRED,
		StockAdjustmentReasonEnum.LOST,
		StockAdjustmentReasonEnum.THEFT,
		StockAdjustmentReasonEnum.SAMPLE,
	],
	[StockAdjustmentDirectionEnum.ADD]: [
		StockAdjustmentReasonEnum.AUDIT,
		StockAdjustmentReasonEnum.FOUND,
		StockAdjustmentReasonEnum.SAMPLE_RETURNED,
		StockAdjustmentReasonEnum.RETURN,
	],
};

export const StockAdjustmentStatusEnum = {
	CREATED: 'created', // The lots moved and the ledger says so
	REVERSED: 'reversed', // Undone by opposing movements; nothing it did still stands
} as const;

export type StockAdjustmentStatus =
	(typeof StockAdjustmentStatusEnum)[keyof typeof StockAdjustmentStatusEnum];

/**
 * Applied on creation and reversed at most once. There is no draft: an adjustment is a statement
 * about the shelf as it is now, and one held back would be a statement about a shelf that has
 * moved on since.
 */
export const STATUS_TRANSITIONS: StatusTransitions<StockAdjustmentStatus> = {
	[StockAdjustmentStatusEnum.CREATED]: [StockAdjustmentStatusEnum.REVERSED],
	[StockAdjustmentStatusEnum.REVERSED]: [
		// Allow nothing
	],
};

const ENTITY_TABLE_NAME = 'stock_adjustment';

/**
 * A change to stock made by hand, with no document behind it - units added or removed at one
 * warehouse, for a stated reason. The row is what the operator decided; its `warehouse_movement`
 * rows (`source_type = 'adjustment'`, `source_id` = this id) are what that did to each lot.
 *
 * One row rather than notes on the movements because one decision touches several lots: removing
 * 12 against lots of 10 and 10 is two movements and one reason, and undoing it has to undo both.
 *
 * The direction is the sign of `qty` rather than a column of its own - a second place to say it
 * would be a second place to get it wrong.
 *
 * **Never edited.** The only change after insert is `created -> reversed`, which posts the opposing
 * movements; a wrong figure is reversed and posted again. Soft delete is refused by the repository
 * for the same reason the ledger refuses it - a row that vanished would leave movements nothing
 * explains.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Stock added or removed by hand, with a reason; its warehouse_movement rows point back here',
})
@Index('IDX_stock_adjustment_warehouse_variant', ['warehouse_id', 'variant_id'])
// The sign is the direction, and each direction admits its own reasons - `STOCK_ADJUSTMENT_REASONS`
@Check(`
	(
		(qty < 0 AND reason IN ('audit', 'damaged', 'expired', 'lost', 'theft', 'sample'))
		OR
		(qty > 0 AND reason IN ('audit', 'found', 'sample_returned', 'return'))
	)
`)
export default class StockAdjustmentEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column({
		type: 'enum',
		enum: StockAdjustmentReasonEnum,
		nullable: false,
	})
	reason!: StockAdjustmentReason;

	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment:
			'Signed change posted to the lots; positive adds, negative removes',
		transformer: numericTransformer,
	})
	qty!: number;

	@Column({
		type: 'enum',
		enum: StockAdjustmentStatusEnum,
		default: StockAdjustmentStatusEnum.CREATED,
		nullable: false,
	})
	status!: StockAdjustmentStatus;

	@Column({ type: 'timestamp', nullable: true })
	reversed_at!: Date | null;

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@Column('int', { nullable: false })
	warehouse_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_stock_adjustment_variant_id')
	variant_id!: number;

	@ManyToOne('WarehouseEntity', { onDelete: 'RESTRICT' })
	@JoinColumn({ name: 'warehouse_id' })
	warehouse!: WarehouseEntity;

	@ManyToOne('ProductVariantEntity', { onDelete: 'RESTRICT' })
	@JoinColumn({ name: 'variant_id' })
	variant!: ProductVariantEntity;
}
