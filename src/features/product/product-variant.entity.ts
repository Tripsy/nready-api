import {
	Check,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type ProductEntity from '@/features/product/product.entity';
import type ProductPriceEntity from '@/features/product/product-price.entity';
import type ProductVariantAttributeEntity from '@/features/product/product-variant-attribute.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'product_variant';

/**
 * The purchasable unit. A product is the thing in the catalog ("Margherita", "Oxford shirt"); a
 * variant is what a customer actually puts in the basket ("Margherita, large", "Oxford shirt, M,
 * blue") and what a price is attached to.
 *
 * **Every product carries at least one variant, even when nothing varies.** A single-variant
 * product is the normal case, not a special one - the alternative, prices hanging off both the
 * product and the variant, means two places to look for the answer and a rule about which wins.
 * The service layer creates the default variant alongside the product.
 *
 * What distinguishes one variant from another is recorded in `product_variant_attribute`, so the
 * axes are whatever the catalog needs rather than a fixed size/color pair.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'The purchasable unit of a product; prices and order lines reference this, not the product',
})
// Redundant on its own - `id` is already unique - but it is the target a composite foreign key
// needs. `order_line` points at (variant_id, product_id) together, which is what stops a line
// naming a variant that belongs to a different product
@Index('IDX_product_variant_id_product_id', ['id', 'product_id'], {
	unique: true,
})
@Check(`(cost_price IS NULL OR cost_price >= 0)`)
// Reads are almost always "every variant of this product, in display order"
@Index('IDX_product_variant_product_id', ['product_id', 'position'])
// At most one default per product. Partial rather than a check constraint, because the rule is
// about the set of rows for a product, which a row-level check cannot see
@Index('IDX_product_variant_default', ['product_id'], {
	unique: true,
	where: 'is_default = true AND deleted_at IS NULL',
})
export default class ProductVariantEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	product_id!: number;

	@Column('varchar', {
		nullable: false,
		comment:
			'The code that is actually sold; `product.sku` is the style above it',
	})
	@Index('IDX_product_variant_sku', {
		unique: true,
		where: 'deleted_at IS NULL',
	})
	sku!: string;

	// Sits here rather than on the product: a barcode identifies one sellable unit, so two sizes
	// of the same item carry two different ones
	@Column('varchar', {
		nullable: true,
		comment: 'External identifier (EAN / UPC / GTIN)',
	})
	@Index('IDX_product_variant_barcode', {
		unique: true,
		where: 'barcode IS NOT NULL AND deleted_at IS NULL',
	})
	barcode!: string | null;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Display order within the product',
	})
	position!: number;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'The variant offered when the customer has not chosen one',
	})
	is_default!: boolean;

	/**
	 * Whether this variant's quantity is tracked at all. False for a restaurant dish, true for a
	 * shirt on a shelf.
	 *
	 * Cannot be derived from `product.type`: a dish and a print-on-demand shirt are both
	 * `physical`, and neither is stocked. Inert unless the `grn` feature is installed - nothing
	 * here references it, it only gates whether that feature's machinery fires.
	 */
	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'Whether goods receipts and stock movements apply to it',
	})
	track_stock!: boolean;

	@Column('int', {
		nullable: true,
		comment: 'Quantity at or below which the variant counts as low stock',
	})
	low_stock_threshold!: number | null;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'Whether it can still be ordered with nothing on hand',
	})
	allow_backorder!: boolean;

	/**
	 * What the goods cost, in the application's base currency (`app.currency`) - no currency
	 * column, because there is only ever one. Prices are quoted per market and belong in
	 * `product_price`; cost is an accounting figure and the books are kept in one currency.
	 *
	 * A purchase in another currency is converted once, at the exchange rate of the receiving day,
	 * and frozen here - never converted again at read time, where a moving rate would make last
	 * month's margin change. Margin is settled in base currency on both sides:
	 * `order_line.exchange_rate` brings the sale back to meet this.
	 *
	 * **It never moves what a customer is charged.** Reporting reads it; no pricing or discount
	 * path does. A floor on a sale is `product_price.min_price` alone - deriving one from cost
	 * would make the price of two identical items differ by their purchase history, and would
	 * shift the moment a goods receipt recomputes the average below.
	 *
	 * Once goods receipts exist this becomes a weighted moving average, recomputed on each
	 * confirmed receipt as
	 * `(qty_on_hand × cost_price + received_qty × unit_cost_base) / (qty_on_hand + received_qty)`.
	 * Inbound only - selling stock must not move what it cost.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: true,
		comment:
			'Weighted average acquisition cost in the base currency; drives margin reporting',
		transformer: numericTransformer,
	})
	cost_price!: number | null;

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;

	@OneToMany(
		'ProductPriceEntity',
		(price: ProductPriceEntity) => price.variant,
	)
	prices?: ProductPriceEntity[];

	@OneToMany(
		'ProductVariantAttributeEntity',
		(attribute: ProductVariantAttributeEntity) => attribute.variant,
	)
	attributes?: ProductVariantAttributeEntity[];
}
