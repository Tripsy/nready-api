import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import type OrderLineEntity from '@/features/order/order-line.entity';
import type ShippingEntity from '@/features/shipping/shipping.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

/**
 * What a line bills for, and with it which source column may be filled.
 *
 * `SHIPPING` is a line rather than a column on the invoice because the money for a delivery lives
 * on the `shipping` row - `OrderService.computeTotals` deliberately leaves it out of the order
 * total - and an order that travels as two parcels is charged for two.
 */
export const InvoiceLineKindEnum = {
	PRODUCT: 'product',
	SHIPPING: 'shipping',
	ADJUSTMENT: 'adjustment', // Rounding, a manual correction, anything with no source row
} as const;

export type InvoiceLineKind =
	(typeof InvoiceLineKindEnum)[keyof typeof InvoiceLineKindEnum];

const ENTITY_TABLE_NAME = 'invoice_line';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores invoice line items',
})
@Check(`(quantity > 0)`)
@Check(`(unit_price >= 0)`)
@Check(`(vat_rate >= 0)`)
@Check(`(discount_reduction >= 0)`)
// Which source a line may name follows from its kind, and nothing else enforces it: an invoice is
// written once and never re-validated, so a shipping line pointing at an order line would survive
// forever
@Check(`
	(
		(kind = 'product' AND shipping_id IS NULL)
		OR (kind = 'shipping' AND order_line_id IS NULL)
		OR (kind = 'adjustment' AND order_line_id IS NULL AND shipping_id IS NULL)
	)
`)
// A value reversal takes money back off a line of the original, so it names that line; and it
// returns no goods and no delivery, so it names neither source row
@Check(`
	(
		is_value_reversal = false
		OR (parent_line_id IS NOT NULL AND order_line_id IS NULL AND shipping_id IS NULL)
	)
`)
export default class InvoiceLineEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_invoice_line_invoice_id')
	invoice_id!: number;

	@Column({
		type: 'enum',
		enum: InvoiceLineKindEnum,
		default: InvoiceLineKindEnum.PRODUCT,
		nullable: false,
	})
	kind!: InvoiceLineKind;

	/**
	 * Where the line came from. Both are `SET NULL` rather than `RESTRICT`: the invoice is the
	 * document of record and carries its own `label` and figures, so losing the row it was raised
	 * from must not take the invoice with it - nor keep an order line alive purely because it was
	 * once billed.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_invoice_line_order_line_id', {
		where: 'order_line_id IS NOT NULL',
	})
	order_line_id!: number | null;

	@Column('int', { nullable: true })
	@Index('IDX_invoice_line_shipping_id', {
		where: 'shipping_id IS NOT NULL',
	})
	shipping_id!: number | null;

	/**
	 * On a reversal, the line of the original document this one takes back. What caps a partial
	 * reversal: a line can be taken back up to its own quantity across every reversal raised
	 * against it, and an `adjustment` line names no source row to count by otherwise.
	 *
	 * RESTRICT: the original is an issued document and is never deleted while a reversal stands.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_invoice_line_parent_line_id', {
		where: 'parent_line_id IS NOT NULL',
	})
	parent_line_id!: number | null;

	/**
	 * On a reversal, whether this line takes back **value** rather than quantity: a price
	 * correction on goods the client keeps. Written as one unit worth the net amount taken back,
	 * at the original line's VAT rate.
	 *
	 * It names no `order_line_id` or `shipping_id`, so it releases nothing for billing again - the
	 * goods and the delivery are still the client's. What it caps is the original line's value:
	 * every reversal against a line, by quantity or by value, together takes back at most that
	 * line's net.
	 */
	@Column('boolean', { nullable: false, default: false })
	is_value_reversal!: boolean;

	/**
	 * What was sold, kept for reporting that groups by product without joining back through a
	 * source row that may be gone.
	 *
	 * Deliberately **no** foreign key, unlike `order_line`: the pair there carries a `RESTRICT`
	 * that keeps a sold variant from being deleted, and an invoice - which is never deleted -
	 * would extend that hold over the catalogue permanently.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_invoice_line_product_id', { where: 'product_id IS NOT NULL' })
	product_id!: number | null;

	@Column('int', { nullable: true })
	variant_id!: number | null;

	@Column('varchar', {
		nullable: false,
		comment:
			'What is billed, as it read on the day - name plus any options',
	})
	label!: string;

	/*
	 * `numeric` for the same reason `order_line.quantity` is one: `product.unit` allows `kg`,
	 * `litre`, `metre` and `hour`, so a line may read 0.75 kg.
	 */
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	quantity!: number;

	// COST RELATED
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment: 'Unit price excluding VAT, in the invoice currency',
		transformer: numericTransformer,
	})
	unit_price!: number;

	@Column('decimal', {
		precision: 5,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	vat_rate!: number;

	@Column('jsonb', {
		nullable: true,
		comment: 'Array of discount snapshots applied',
	})
	discount?: DiscountSnapshot[] | null;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Money off the whole line, excluding VAT',
		transformer: numericTransformer,
	})
	discount_reduction!: number;

	/*
	 * The line's own arithmetic, stored rather than derived: `line_net` is
	 * `unit_price * quantity - discount_reduction`, `line_vat` is `line_net * vat_rate / 100` and
	 * `line_total` is their sum. A printed document has to keep adding up years later, whatever
	 * the rounding helper does by then.
	 *
	 * All three stay positive - a reversal subtracts by virtue of `invoice.is_reversal`, the same way
	 * `cash_flow` keeps `amount > 0` and lets `direction` carry the sign.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	line_net!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	line_vat!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	line_total!: number;

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('InvoiceEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'invoice_id' })
	invoice!: InvoiceEntity;

	@ManyToOne('OrderLineEntity', {
		onDelete: 'SET NULL',
		nullable: true,
	})
	@JoinColumn({ name: 'order_line_id' })
	order_line?: OrderLineEntity | null;

	@ManyToOne('ShippingEntity', {
		onDelete: 'SET NULL',
		nullable: true,
	})
	@JoinColumn({ name: 'shipping_id' })
	shipping?: ShippingEntity | null;

	@ManyToOne('InvoiceLineEntity', {
		onDelete: 'RESTRICT',
		nullable: true,
	})
	@JoinColumn({ name: 'parent_line_id' })
	parent_line?: InvoiceLineEntity | null;
}
