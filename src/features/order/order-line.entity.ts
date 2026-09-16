import {
	Check,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import type OrderEntity from '@/features/order/order.entity';
import type { ProductOptionSnapshot } from '@/features/product/product-option.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'order_line';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores order line items',
})
@Check(`(quantity > 0)`)
// Zero is legal: a bundle header line carries no money of its own, the component lines it explodes
// into carry all of it
@Check(`(price >= 0)`)
@Check(`(vat_rate >= 0)`)
@Check(`(discount_reduction >= 0)`)
export default class OrderLineEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_order_line_order_id')
	order_id!: number;

	/**
	 * Set on the component lines a bundle explodes into; NULL on an ordinary line and on the
	 * bundle header itself.
	 *
	 * A bundle cannot be one line: its components may sit in different VAT categories - food at
	 * 11% next to beer at 21% - and a single `vat_rate` cannot represent that. So the header line
	 * records what was sold at `price = 0`, and the children carry the money, each with the
	 * apportioned share of the bundle price and its own rate. `SUM(price)` over the order stays
	 * correct with no special-casing, and stock, refunds and reporting all land on real variants.
	 *
	 * Apportionment is pro-rata by the components' standalone prices, with the rounding remainder
	 * assigned to the largest share so the parts reconcile to the charged total exactly.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_order_line_parent_id', {
		where: 'parent_id IS NOT NULL',
	})
	parent_id!: number | null;

	/**
	 * What was bought. `product_id` is kept alongside it, denormalized, because every revenue
	 * report groups by product and would otherwise join through the variant to get there.
	 *
	 * The two cannot drift: the `variant` relation below is a **composite** foreign key over both
	 * columns at once, pointing at `product_variant (id, product_id)`. A line naming a variant that
	 * belongs to a different product is rejected by the database rather than by a service check
	 * somebody has to remember to write.
	 */
	@Column('int', { nullable: false })
	@Index('IDX_order_line_variant_id')
	variant_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_order_line_product_id')
	product_id!: number;

	/*
	 * `numeric` rather than `int` because a quantity is not always a count: `product.unit` allows
	 * `kg`, `litre`, `metre` and `hour`, so a line may read 0.75 kg or 1.5 hours. The scale sets
	 * how finely those divide - two decimals, so 10 g is the smallest step a weighed product can
	 * be sold in. The precision is inherited from the money columns and is far wider than any
	 * quantity needs; nothing depends on it being 12.
	 *
	 * The transformer is what keeps the type honest: node-postgres hands a `numeric` over as a
	 * string, so without it the column arrives as `"1.00"` while the type here says `number` - and
	 * every multiplication against a price becomes a coercion nobody wrote down.
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

	/**
	 * Money off the whole line - `quantity` included - in `currency`, already clamped against
	 * `product_price.min_price` at the moment the document was raised.
	 *
	 * Stored beside the snapshot rather than derived from it: the snapshot carries the rule
	 * (`percent`, `12`) and not the floor it was cut down to, so replaying it later would produce
	 * a figure that is right only when nothing was clamped. `price` stays the unit figure the line
	 * was quoted at, which is what an invoice has to show the reduction against.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Money off the whole line, in the line currency',
		transformer: numericTransformer,
	})
	discount_reduction!: number;

	// `price` already has these deltas folded in; they describe how the figure was reached and are
	// never added to it again (`product.md` §5). Snapshot rather than a join table for the same
	// reason `discount` is one - the option may be renamed, repriced or withdrawn, and the charged
	// figure must not move with it
	@Column('jsonb', {
		nullable: true,
		comment:
			'Array of option snapshots chosen, each carrying its price delta',
	})
	options?: ProductOptionSnapshot[];

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('OrderEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'order_id' })
	order!: OrderEntity;

	// CASCADE: the component lines exist only to break the header down, so removing it takes them
	@ManyToOne('OrderLineEntity', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({ name: 'parent_id' })
	parent?: OrderLineEntity | null;

	@OneToMany('OrderLineEntity', (child: OrderLineEntity) => child.parent)
	children?: OrderLineEntity[];

	// Composite: both columns are the key, so the pair has to exist together on one variant row.
	// It also carries the RESTRICT that keeps a sold variant - and through it its product, since
	// deleting a product cascades to its variants - from being deleted out from under an order
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn([
		{ name: 'variant_id', referencedColumnName: 'id' },
		{ name: 'product_id', referencedColumnName: 'product_id' },
	])
	variant!: ProductVariantEntity;
}
