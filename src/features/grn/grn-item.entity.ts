import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type GrnEntity from '@/features/grn/grn.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'grn_item';

/**
 * A received line - **and the FIFO lot it creates**. The two are the same row because a lot is
 * exactly "these units, at this cost, received on this day", which is what a receipt line already
 * says.
 *
 * `qty_remaining` is the authoritative on-hand figure. Quantity for a variant in a warehouse is
 * `SUM(qty_remaining)` over its open lots on confirmed receipts - a handful of rows, rather than a
 * replay of the whole ledger. `warehouse_movement` is the audit trail that explains how it got
 * there, and a reconciliation job compares the two and reports drift rather than silently
 * correcting it.
 *
 * FIFO consumes the oldest open lot first, so a sale of 14 against lots of 10 and 10 produces two
 * movements at two different costs. That is why the lot is recorded on the movement and never on
 * the order line: a line can only name one lot, and one line routinely spans several.
 *
 * **Pick order is `(grn.received_at, grn_item.id)`, and the tie-break is not optional.** Two
 * deliveries landing the same day tie on the timestamp alone, and an unordered pick would consume
 * different lots on a replay and report a different cost of goods for the same sale.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Received lines; each is a FIFO lot, and qty_remaining is the authoritative on-hand figure',
})
// One line per variant per receipt. A delivery that physically contains two lots of the same
// variant - an old production run and a new one at a different cost, or two expiry dates - is
// entered as two receipts, so the document and the lot stay one-to-one
@Index('IDX_grn_item_unique', ['grn_id', 'variant_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
// The FIFO pick list: open lots for one variant. Partial, because a closed lot is never a
// candidate and the closed ones accumulate forever
@Index('IDX_grn_item_variant_open', ['variant_id'], {
	where: 'qty_remaining > 0 AND deleted_at IS NULL',
})
// Full index for the RESTRICT check a variant delete runs against this table; the partial one
// above cannot serve it, since a closed lot still blocks the delete
@Index('IDX_grn_item_variant_id', ['variant_id'])
@Check(`(qty > 0)`)
@Check(`(qty_remaining >= 0 AND qty_remaining <= qty)`)
@Check(`(unit_cost >= 0)`)
@Check(`(unit_cost_base >= 0)`)
export default class GrnItemEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	grn_id!: EntityId;

	@Column('uuid', { nullable: false })
	variant_id!: EntityId;

	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment: 'Quantity received; never changes once confirmed',
		transformer: numericTransformer,
	})
	qty!: number;

	// Defaults to 0 so a draft line holds no stock without anyone having to say so. Confirmation
	// sets it to `qty`; seeding it at insert time would put stock on the shelf before the receipt
	// was accepted
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Quantity still in this lot; 0 means the lot is closed',
		transformer: numericTransformer,
	})
	qty_remaining!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment: 'Unit cost as invoiced, in the receipt currency',
		transformer: numericTransformer,
	})
	unit_cost!: number;

	// Scale 4 rather than 2: this is a converted figure that every FIFO valuation multiplies, and
	// rounding it to the cent here would compound across a lot's whole life
	@Column('decimal', {
		precision: 12,
		scale: 4,
		nullable: false,
		comment:
			'Unit cost in base currency, frozen at the receipt exchange rate',
		transformer: numericTransformer,
	})
	unit_cost_base!: number;

	@Column('decimal', {
		precision: 5,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'VAT rate on the purchase, for the payable',
		transformer: numericTransformer,
	})
	vat_rate!: number;

	@Column('varchar', {
		nullable: true,
		comment: "The supplier's batch identifier, when they give one",
	})
	lot_code!: string | null;

	// Costs nothing while unused, and is the difference between FIFO and FEFO later - a kitchen
	// picks the soonest to expire, not the oldest received
	@Column('date', {
		nullable: true,
		comment: 'Expiry date of this lot, when the goods carry one',
	})
	expires_at!: string | null;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('GrnEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'grn_id' })
	grn!: GrnEntity;

	// RESTRICT: the lot is the accounting record of what these units cost, and it has to outlive
	// any tidying up of the catalog
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'variant_id' })
	variant!: ProductVariantEntity;
}
