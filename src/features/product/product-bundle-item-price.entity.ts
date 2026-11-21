import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_bundle_item_price';

/**
 * What taking an optional component does to the bundle's total, in one market.
 *
 * Per currency, like `product_price` and `product_option_price`, and for the same reason: a delta
 * carries a currency whether or not a column says so, and adding 3 to a figure quoted in EUR is
 * only right if the 3 is EUR.
 *
 * The figure adjusts the **component's own sale price**, not the bundle's - the bundle price
 * covers the components that are always included, and a ticked optional one adds
 * `variant.sale_price + price_delta`. A negative delta is therefore the usual case: it is the
 * discount for taking the component inside the kit rather than buying it on its own.
 *
 * Only an optional component may carry one. On a component that is always included the figure has
 * nothing to adjust, since the bundle price already covers it - `ProductValidator` refuses it.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Per-currency price delta for an optional bundle component; excludes VAT, like product-price.entity',
})
@Index('IDX_product_bundle_item_price_unique', ['item_id', 'currency'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class ProductBundleItemPriceEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	/*
	 * Non-partial on purpose. `ProductBundleRepository.syncPrices` reads this key with `withDeleted`, so it can revive a
	 * row rather than collide with the partial unique index, and no index carrying
	 * `WHERE deleted_at IS NULL` answers a query that does not say it. The foreign key's cascade
	 * looks the children up the same way.
	 */
	@Column('uuid', { nullable: false })
	@Index('IDX_product_bundle_item_price_item_id')
	item_id!: EntityId;

	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
	})
	currency!: string;

	// No positivity check, unlike `product_price.sale_price` - a discount for taking the component
	// as part of the kit is the point, so the delta is signed
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment:
			'Added to the component price when it is taken; negative subtracts',
		transformer: numericTransformer,
	})
	price_delta!: number;

	// RELATIONS
	@ManyToOne('ProductBundleItemEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'item_id' })
	item!: ProductBundleItemEntity;
}
