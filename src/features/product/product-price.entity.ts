import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'product_price';

/**
 * Keyed on the variant, not the product: two sizes of one dish are two prices, and a product with
 * nothing to vary still reaches its price through its single default variant. One place to look.
 *
 * **Sales side only.** Every figure here is what a customer is quoted in one market, set rather
 * than converted. What the goods cost is a single base-currency number on
 * `product_variant.cost_price`, because the books are kept in one currency and margin is settled
 * there - `order_line.exchange_rate` brings the sale back to base to meet it.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Per-currency price set for a product variant; every value excludes VAT, matching the contract discounts are applied under',
})
@Index('IDX_product_price_unique', ['variant_id', 'currency'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
@Check(`(sale_price > 0)`)
@Check(`(reference_price IS NULL OR reference_price > 0)`)
@Check(`(min_price IS NULL OR min_price <= sale_price)`)
export default class ProductPriceEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	/*
	 * Non-partial on purpose. `ProductVariantRepository.syncPrices` reads this key with `withDeleted`, so it can revive a
	 * row rather than collide with the partial unique index, and no index carrying
	 * `WHERE deleted_at IS NULL` answers a query that does not say it. The foreign key's cascade
	 * looks the children up the same way.
	 */
	@Column('int', { nullable: false })
	@Index('IDX_product_price_variant_id')
	variant_id!: number;

	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
	})
	currency!: string;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment: 'What the customer is charged, per `product.unit`',
		transformer: numericTransformer,
	})
	sale_price!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: true,
		comment:
			"The usual price this sale is measured against (a manufacturer's RRP, a list price); display only, never charged",
		transformer: numericTransformer,
	})
	reference_price!: number | null;

	// The discount engine stacks percentages and amounts, so without a floor a coupon on top of a
	// campaign takes the line to zero. This is the *only* floor: `cost_price` does not stand in
	// for a missing one, so a seller who wants cost respected states it here, per market, in the
	// currency the sale is quoted in
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: true,
		comment: 'Lowest price a discount may resolve to',
		transformer: numericTransformer,
	})
	min_price!: number | null;

	// RELATIONS
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'variant_id' })
	variant!: ProductVariantEntity;
}
