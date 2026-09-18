import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type BrandEntity from '@/features/brand/brand.entity';
import type ProductAttributeEntity from '@/features/product/product-attribute.entity';
import type ProductAvailabilityEntity from '@/features/product/product-availability.entity';
import type ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import type ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import type ProductCategoryEntity from '@/features/product/product-category.entity';
import type ProductContentEntity from '@/features/product/product-content.entity';
import type ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import type ProductTagEntity from '@/features/product/product-tag.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';

export const ProductWorkflowEnum = {
	DRAFT: 'draft', // Initial creation
	PENDING_REVIEW: 'pending_review', // Awaiting approval
	REVISION_REQUIRED: 'revision_required', // Needs changes
	READY: 'ready', // Ready to be sold
} as const;

export type ProductWorkflow =
	(typeof ProductWorkflowEnum)[keyof typeof ProductWorkflowEnum];

// Allowed status transition configuration
export const WORKFLOW_TRANSITIONS: StatusTransitions<ProductWorkflow> = {
	[ProductWorkflowEnum.DRAFT]: [ProductWorkflowEnum.PENDING_REVIEW],
	[ProductWorkflowEnum.PENDING_REVIEW]: [
		ProductWorkflowEnum.REVISION_REQUIRED,
		ProductWorkflowEnum.READY,
	],
	[ProductWorkflowEnum.REVISION_REQUIRED]: [
		ProductWorkflowEnum.PENDING_REVIEW,
	],
	[ProductWorkflowEnum.READY]: [
		// Allow nothing
	],
};

/**
 * Derived, never set directly from a payload: a cron job recomputes it from `available_from`,
 * `available_until` and `discontinued_at`. That is also why it carries no transition map - the
 * timestamps are the input the user edits, this is only their projection.
 */
export const ProductSaleStatusEnum = {
	AVAILABLE: 'available', // Sellable now
	COMING_SOON: 'coming_soon', // `available_from` is in the future
	UNAVAILABLE: 'unavailable', // `available_until` has passed
	DISCONTINUED: 'discontinued', // `discontinued_at` is set - permanent
} as const;

export type ProductSaleStatus =
	(typeof ProductSaleStatusEnum)[keyof typeof ProductSaleStatusEnum];

export const ProductTypeEnum = {
	PHYSICAL: 'physical',
	DIGITAL: 'digital',
	SERVICE: 'service',
} as const;

export type ProductType =
	(typeof ProductTypeEnum)[keyof typeof ProductTypeEnum];

/**
 * Whether the product is sold on its own or assembled from other products.
 *
 * Separate from `type` on purpose - that describes how a product is fulfilled (physical, digital,
 * service) and stays orthogonal: a bundle of physical goods is both `physical` and `bundle`.
 *
 * A `bundle` holds no stock and its own `vat_category` is unused: the components carry both, and
 * the order line explodes into one child per component so each is taxed at its own rate. See
 * `.claude/rules/product.md`.
 */
export const ProductCompositionEnum = {
	SIMPLE: 'simple',
	BUNDLE: 'bundle',
} as const;

export type ProductComposition =
	(typeof ProductCompositionEnum)[keyof typeof ProductCompositionEnum];

/**
 * The unit `price` in `product-price` is quoted per, and the unit a quantity is expressed in.
 */
export const ProductUnitEnum = {
	PIECE: 'piece',
	KG: 'kg',
	LITRE: 'litre',
	METRE: 'metre',
	HOUR: 'hour',
} as const;

export type ProductUnit =
	(typeof ProductUnitEnum)[keyof typeof ProductUnitEnum];

/**
 * Which units each type may be sold in. A service is priced by time, a download has no physical
 * dimension to measure, and only a physical good can be sold by weight, volume or length.
 *
 * Enforced by `ProductService.assertUnitForType` rather than by a column check: the pairing spans
 * two columns and a partial update may move either one alone, so it can only be judged after the
 * payload is merged onto the stored row.
 */
export const UNITS_BY_TYPE: Record<ProductType, readonly ProductUnit[]> = {
	[ProductTypeEnum.PHYSICAL]: [
		ProductUnitEnum.PIECE,
		ProductUnitEnum.KG,
		ProductUnitEnum.LITRE,
		ProductUnitEnum.METRE,
	],
	[ProductTypeEnum.DIGITAL]: [ProductUnitEnum.PIECE],
	[ProductTypeEnum.SERVICE]: [ProductUnitEnum.HOUR],
};

/**
 * The VAT *class* a product declares. The *rate* it resolves to is a function of jurisdiction and
 * date, so it is worked out when the order line is written and snapshot there
 * (`order_line.vat_rate`).
 *
 * Stored as a plain `varchar`, not a Postgres enum, even though the list lives here: the set is
 * jurisdiction-specific and grows, and `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
 * block. Adding a class stays a code change instead of becoming a special-cased migration.
 */
export const ProductVatCategoryEnum = {
	STANDARD: 'standard',
	REDUCED: 'reduced',
	SECOND_REDUCED: 'second_reduced',
	ZERO: 'zero',
	EXEMPT: 'exempt',
} as const;

export type ProductVatCategory =
	(typeof ProductVatCategoryEnum)[keyof typeof ProductVatCategoryEnum];

const ENTITY_TABLE_NAME = 'product';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Stores core product information; textual content is saved in a product-content.entity, prices in a product-price.entity',
})
/*
 * One per deadline, for the cron that recomputes `sale_status`. Its candidate set is an `OR` of
 * the three timestamps and constrains nothing else, so each index leads on the column its branch
 * seeks - a btree only applies a condition on its leading column, and one led by `sale_status`
 * would be reachable by a full scan alone. The partial predicate keeps each to the rows that
 * actually hold that deadline, which is a small slice of the catalog and is what every branch of
 * the `OR` tests for first.
 *
 * They serve the seek and not the selectivity: `available_from <= now()` matches every row that
 * has ever opened, and the clause that makes the set drain - the stored status disagreeing with
 * what the timestamps imply - cannot be indexed. Past the size where the write cost outweighs
 * that, dropping all three and letting the three-hourly pass scan is the better trade.
 */
@Index('IDX_product_available_from', ['available_from'], {
	where: 'available_from IS NOT NULL AND deleted_at IS NULL',
})
@Index('IDX_product_available_until', ['available_until'], {
	where: 'available_until IS NOT NULL AND deleted_at IS NULL',
})
@Index('IDX_product_discontinued_at', ['discontinued_at'], {
	where: 'discontinued_at IS NOT NULL AND deleted_at IS NULL',
})
export default class ProductEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({
		type: 'enum',
		enum: ProductWorkflowEnum,
		default: ProductWorkflowEnum.DRAFT,
		nullable: false,
	})
	/*
	 * The one enum here that carries an index, and the reason is cardinality of the *query*
	 * rather than of the column: `draft`, `pending_review` and `revision_required` are each a
	 * small minority of the catalog and the dashboard's review queue seeks them by name. `type`
	 * and `composition` are skewed facets nothing asks a rare value of, so they carry none - see
	 * `1789800000000-product-drop-enum-facet-indexes.ts`.
	 */
	@Index('IDX_product_workflow')
	workflow!: ProductWorkflow;

	@Column({
		type: 'enum',
		enum: ProductSaleStatusEnum,
		default: ProductSaleStatusEnum.AVAILABLE,
		nullable: false,
	})
	/*
	 * **A projection, never the authority.** Nothing that decides what may be sold reads this:
	 * `filterBySellable` compares the three timestamps directly, because a column a cron catches
	 * up on a schedule trails the deadline it describes between passes. This is what the
	 * dashboard's badge and its status facet are built on, and that is the whole of its job.
	 *
	 * Deliberately unindexed, as `type` and `composition` are. The facet is admin traffic,
	 * paginated, over four values that skew heavily to `available` - a btree Postgres would
	 * decline to use for the common one anyway. The three partial indexes above stay: those serve
	 * the cron, which seeks on a deadline.
	 */
	sale_status!: ProductSaleStatus;

	@Column({
		type: 'enum',
		enum: ProductTypeEnum,
		default: ProductTypeEnum.PHYSICAL,
		nullable: false,
	})
	type!: ProductType;

	@Column({
		type: 'enum',
		enum: ProductCompositionEnum,
		default: ProductCompositionEnum.SIMPLE,
		nullable: false,
	})
	composition!: ProductComposition;

	@Column({
		type: 'enum',
		enum: ProductUnitEnum,
		default: ProductUnitEnum.PIECE,
		nullable: false,
	})
	unit!: ProductUnit;

	@Column('varchar', {
		length: 32,
		nullable: false,
		default: ProductVatCategoryEnum.STANDARD,
		comment: 'VAT class key; see ProductVatCategoryEnum',
	})
	vat_category!: ProductVatCategory;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'Controls when the product becomes sellable',
	})
	available_from!: Date | null;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'Controls when the product stops being sellable',
	})
	available_until!: Date | null;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment:
			'Set once the product is permanently withdrawn from the catalog',
	})
	discontinued_at!: Date | null;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// Nullable: plenty of catalogs sell unbranded items - a restaurant dish has no manufacturer,
	// and inventing a placeholder brand row to satisfy the key is worse than an absent one
	@Column('int', { nullable: true })
	@Index('IDX_product_brand_id')
	brand_id!: number | null;

	// RELATIONS
	// RESTRICT even though the column is nullable: an absent brand is a legitimate state, silently
	// losing the one that was set is not
	@ManyToOne('BrandEntity', {
		onDelete: 'RESTRICT',
		nullable: true,
	})
	@JoinColumn({ name: 'brand_id' })
	brand?: BrandEntity | null;

	@OneToMany(
		'ProductContentEntity',
		(content: ProductContentEntity) => content.product,
	)
	contents?: ProductContentEntity[];

	// Prices hang off the variant, not the product - a product is priced only through them
	@OneToMany(
		'ProductVariantEntity',
		(variant: ProductVariantEntity) => variant.product,
	)
	variants?: ProductVariantEntity[];

	@OneToMany(
		'ProductOptionGroupEntity',
		(optionGroup: ProductOptionGroupEntity) => optionGroup.product,
	)
	option_groups?: ProductOptionGroupEntity[];

	@OneToMany(
		'ProductAvailabilityEntity',
		(availability: ProductAvailabilityEntity) => availability.product,
	)
	availabilities?: ProductAvailabilityEntity[];

	/*
	 * Both populated only while `composition` is `bundle`. A component is included unless it is
	 * `is_optional` or a candidate in one of the groups, which are held flat here for the same
	 * reason the payload holds them flat - a component belongs to a group or to no group, and one
	 * list beats two places to read it from.
	 */
	@OneToMany(
		'ProductBundleGroupEntity',
		(bundleGroup: ProductBundleGroupEntity) => bundleGroup.product,
	)
	bundle_groups?: ProductBundleGroupEntity[];

	@OneToMany(
		'ProductBundleItemEntity',
		(bundleItem: ProductBundleItemEntity) => bundleItem.product,
	)
	bundle_items?: ProductBundleItemEntity[];

	@OneToMany('ProductTagEntity', (tag: ProductTagEntity) => tag.product)
	tags?: ProductTagEntity[];

	@OneToMany(
		'ProductCategoryEntity',
		(productCategory: ProductCategoryEntity) => productCategory.product,
	)
	categories?: ProductCategoryEntity[];

	@OneToMany(
		'ProductAttributeEntity',
		(attribute: ProductAttributeEntity) => attribute.product,
	)
	attributes?: ProductAttributeEntity[];
}
