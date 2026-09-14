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

const ENTITY_TABLE_NAME = 'order_product';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores ordered products (order line items)',
})
@Check(`(quantity > 0)`)
// Zero is legal: a bundle header line carries no money of its own, the component lines it explodes
// into carry all of it
@Check(`(price >= 0)`)
@Check(`(vat_rate >= 0)`)
export default class OrderProductEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_order_product_order_id')
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
	@Index('IDX_order_product_parent_id', {
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
	@Index('IDX_order_product_variant_id')
	variant_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_order_product_product_id')
	product_id!: number;

	@Column('numeric', { precision: 12, scale: 2, nullable: false })
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

	// `price` is the variant price alone; the deltas recorded here are what reconciles it with the
	// line total. Snapshot rather than a join table for the same reason `discount` is one - the
	// option may be renamed, repriced or withdrawn, and the charged figure must not move with it
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
	@ManyToOne('OrderProductEntity', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({ name: 'parent_id' })
	parent?: OrderProductEntity | null;

	@OneToMany(
		'OrderProductEntity',
		(child: OrderProductEntity) => child.parent,
	)
	children?: OrderProductEntity[];

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
