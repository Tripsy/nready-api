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
import type ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import type ProductBundleItemPriceEntity from '@/features/product/product-bundle-item-price.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_bundle_item';

/**
 * A component of a bundle: the cheeseburger that is part of the burger menu. `product_id` names
 * the bundle it belongs to, and `group_id` the choice it is a candidate for, if any.
 *
 * A row is one of three things, and the two flags read against `group_id` rather than on their
 * own:
 *
 * 1. **Always included** - no group, `is_optional = false`. Part of the kit, covered by the
 *    bundle's own price.
 * 2. **An independent tick box** - no group, `is_optional = true`. The customer takes none to
 *    `quantity` of it, bounded by nothing else.
 * 3. **A candidate** - `group_id` set. The group decides how many of its candidates are taken,
 *    so `is_optional` is meaningless here and refused: the row is neither always included nor
 *    free to be taken on its own terms.
 *
 * Taking a component under 2 or 3 adds `variant.sale_price + price_delta` per unit, where the
 * delta is the per-currency figure in `product_bundle_item_price`. One meaning in both cases: it
 * adjusts the component's own price, never the bundle's. Making a candidate free therefore means
 * a delta of its whole price, not zero.
 *
 * `quantity` is a **ceiling** on 2 alone - the most the customer may take of that tick box - and a
 * plain count on 1 and 3. A candidate is not a ceiling: its group decides *which* candidate is
 * taken, never how many of it, so the figure is what the bundle contains once that candidate is
 * the one chosen. See `.claude/rules/product.md` §8.
 *
 * Distinct from `product_option`, which `product_bundle_group` otherwise mirrors: an option's
 * answer is a label with a delta and nothing behind it, where a candidate here is a variant, so it
 * consumes stock.
 *
 * `variant_id` points at what is actually consumed, so stock, VAT class and cost all come from the
 * component rather than the bundle.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'A component of a bundle: always included, an optional tick box, or a candidate within a group',
})
// Rendering a bundle reads every component it has, in display order
@Index('IDX_product_bundle_item_product_id', ['product_id', 'position'])
// Needed for the RESTRICT check a variant delete runs against this table
@Index('IDX_product_bundle_item_variant_id', ['variant_id'])
// Rendering a group reads its candidates, in display order
@Index('IDX_product_bundle_item_group_id', ['group_id', 'position'])
// At most one preselected candidate per group, the rule `product_option.is_default` holds by the
// same means. Scoped to `group_id IS NOT NULL` so ungrouped tick boxes are left alone
@Index('IDX_product_bundle_item_default', ['group_id'], {
	unique: true,
	where: 'is_default = true AND group_id IS NOT NULL AND deleted_at IS NULL',
})
@Check(`(quantity > 0)`)
export default class ProductBundleItemEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', {
		nullable: false,
		comment: 'The bundle this component belongs to',
	})
	product_id!: EntityId;

	@Column('uuid', {
		nullable: false,
		comment:
			'The variant consumed when this component is part of the order',
	})
	variant_id!: EntityId;

	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 1,
		comment:
			'How many of the variant this component contributes, or the most the customer may take when is_optional',
	})
	quantity!: number;

	@Column('uuid', {
		nullable: true,
		comment:
			'The choice this component is a candidate for; NULL means it is not part of one',
	})
	group_id!: EntityId | null;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Display order within the group, or within the bundle',
	})
	position!: number;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment:
			'The customer chooses whether to take this component on its own terms; refused inside a group, where the group decides',
	})
	is_optional!: boolean;

	/*
	 * The partial unique index below scopes "at most one preselected" to a group, and to a group
	 * only. Outside one there is nothing to scope it to: independent tick boxes are not
	 * alternatives to each other, so any number of them may start ticked.
	 */
	@Column('boolean', {
		nullable: false,
		default: false,
		comment:
			'Preselected; meaningless on a component that is neither optional nor in a group',
	})
	is_default!: boolean;

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;

	// RESTRICT: a bundle whose component vanished is silently incomplete, and nothing would report
	// it - better to block the delete and force the bundle to be edited first
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'variant_id' })
	variant!: ProductVariantEntity;

	@ManyToOne('ProductBundleGroupEntity', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({ name: 'group_id' })
	group!: ProductBundleGroupEntity | null;

	@OneToMany(
		'ProductBundleItemPriceEntity',
		(price: ProductBundleItemPriceEntity) => price.item,
	)
	prices?: ProductBundleItemPriceEntity[];
}
