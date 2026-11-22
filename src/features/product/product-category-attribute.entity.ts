import {
	Check,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type CategoryEntity from '@/features/category/category.entity';
import type ProductCategoryAttributeOptionEntity from '@/features/product/product-category-attribute-option.entity';
import type TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { MeasureUnit } from '@/shared/types/measure-unit.type';

/**
 * Which of the two attribute tables a value written against this definition lands in.
 *
 * `product` - descriptive, one row per value in `product_attribute`; a product may carry several
 * under one label (three allergens).
 * `variant` - an axis that distinguishes siblings, written to `product_variant_attribute`; exactly
 * one value per label per variant, because a variant cannot be both `large` and `small`.
 *
 * The form that edits a product cannot place a value without this: *Color* rendered once for the
 * product and *Color* rendered once per variant are different products.
 */
export const ProductCategoryAttributeScopeEnum = {
	PRODUCT: 'product',
	VARIANT: 'variant',
} as const;

export type ProductCategoryAttributeScope =
	(typeof ProductCategoryAttributeScopeEnum)[keyof typeof ProductCategoryAttributeScopeEnum];

/**
 * How the value is stored, which decides the column it occupies on the attribute row and whether it
 * can be filtered as a range.
 *
 * `term` is the odd one out and the one to reach for by default when the value is a word: it points
 * at a shared `attribute_value` term, so the wording is multilingual and one rename corrects every
 * product carrying it. `string` is for a literal owned by a single product - a model code, a batch
 * reference - where sharing would be meaningless.
 */
export const ProductCategoryAttributeValueTypeEnum = {
	TERM: 'term',
	NUMBER: 'number',
	STRING: 'string',
	BOOLEAN: 'boolean',
} as const;

export type ProductCategoryAttributeValueType =
	(typeof ProductCategoryAttributeValueTypeEnum)[keyof typeof ProductCategoryAttributeValueTypeEnum];

/**
 * How the value is captured. Orthogonal to `value_type` - *330* is a number whether it is typed
 * into a field or picked from a list.
 */
export const ProductCategoryAttributeTypeEnum = {
	INPUT: 'input',
	SELECT: 'select',
	RADIO: 'radio',
	CHECKBOX: 'checkbox',
} as const;

export type ProductCategoryAttributeType =
	(typeof ProductCategoryAttributeTypeEnum)[keyof typeof ProductCategoryAttributeTypeEnum];

const ENTITY_TABLE_NAME = 'product_category_attribute';

/**
 * What a product in a given category is expected to say about itself: which attribute labels apply,
 * how each is captured, and which values are admissible.
 *
 * It holds no product data - it is the schema the product form renders from and the validator
 * checks against. The values themselves stay in `product_attribute` /
 * `product_variant_attribute`, keyed on `attribute_label_id` rather than on this row's id, so a
 * product moving between categories keeps everything it has already recorded.
 *
 * The pairing with `unit` is what makes numeric attributes filterable: the definition fixes the
 * unit, so every product under it stores a bare `330` in `product_attribute.value_numeric` and a
 * range query runs on an indexed numeric column instead of parsing `330 ml` out of localized text.
 * Two categories may quote the same label differently - `ml` here, `l` there - because the
 * attribute row also carries `value_base`, the figure converted into the dimension's base unit at
 * write time. A range filter runs on that and is correct across both.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Per-category definition of the attributes a product is expected to carry',
})
@Index(
	'IDX_product_category_attribute_unique',
	['category_id', 'attribute_label_id'],
	{
		unique: true,
		where: 'deleted_at IS NULL',
	},
)
// The only read that matters: every definition for a category, in display order. Leading on
// `category_id` also serves the cascade the category delete triggers
@Index(
	'IDX_product_category_attribute_category_id',
	['category_id', 'sort_order'],
	{
		where: 'deleted_at IS NULL',
	},
)
// Indexed for the cascade `term` triggers on delete - it is not a prefix of the unique index
@Index('IDX_product_category_attribute_label_id', ['attribute_label_id'])
/**
 * The capture and the storage have to agree, and only some pairings mean anything. A list offers
 * shared vocabulary, so it stores terms; a free field cannot offer one, so it stores a literal.
 * `checkbox` reads two ways - a lone yes/no toggle, or a multi-pick over the option rows - and is
 * the only type admitting more than one storage.
 *
 * What this cannot say is that a list-backed definition **has** option rows: they live in
 * `product_category_attribute_option` and a row-level check cannot count another table. That half
 * is enforced in the service layer; see `.claude/rules/product.md` §10.
 */
@Check(`
	(type = 'input' AND value_type IN ('number', 'string', 'boolean'))
	OR (type IN ('select', 'radio') AND value_type = 'term')
	OR (type = 'checkbox' AND value_type IN ('term', 'boolean'))
`)
// A unit only means something on a measurement, and it renders in place of `suffix` - carrying both
// leaves two answers to what follows the number
@Check(`
	(unit IS NULL OR value_type = 'number')
	AND NOT (unit IS NOT NULL AND suffix IS NOT NULL)
`)
// Bounds only mean something for a number, and an empty range would reject every value
@Check(`
	((min_value IS NULL AND max_value IS NULL) OR value_type = 'number')
	AND (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
`)
export default class ProductCategoryAttributeEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	category_id!: EntityId;

	// A `term` of type `attribute_label`, so the wording renders per language while everything that
	// points at it stores the language-neutral id
	@Column('uuid', { nullable: false })
	attribute_label_id!: EntityId;

	@Column({
		type: 'enum',
		enum: ProductCategoryAttributeScopeEnum,
		default: ProductCategoryAttributeScopeEnum.PRODUCT,
		nullable: false,
	})
	scope!: ProductCategoryAttributeScope;

	@Column({
		type: 'enum',
		enum: ProductCategoryAttributeValueTypeEnum,
		default: ProductCategoryAttributeValueTypeEnum.TERM,
		nullable: false,
		comment: 'Decides which value column the attribute row occupies',
	})
	value_type!: ProductCategoryAttributeValueType;

	@Column({
		type: 'enum',
		enum: ProductCategoryAttributeTypeEnum,
		default: ProductCategoryAttributeTypeEnum.SELECT,
		nullable: false,
		comment: 'How the value is captured',
	})
	type!: ProductCategoryAttributeType;

	/**
	 * The unit every value under this definition is quoted in - a `MeasureUnitEnum` key.
	 *
	 * Stored as `varchar` rather than a Postgres enum, for the reason `product.vat_category` gives:
	 * the list grows, and `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so a
	 * new unit stays a code change instead of a special-cased migration.
	 *
	 * Its factor is applied on write to produce `value_base`, which is what range filters compare.
	 * Changing it on a definition that already has values therefore does **not** reinterpret them -
	 * every affected row has to be rewritten through the same conversion, or the stored base
	 * figures now describe a different quantity than the form shows.
	 */
	@Column('varchar', {
		length: 16,
		nullable: true,
		comment: 'MeasureUnitEnum key; numeric attributes only',
	})
	unit!: MeasureUnit | null;

	// Display only, never part of the stored value - `330` is the value, `ml` is how it reads.
	// Keeping them out of the value is what leaves the number filterable
	@Column('varchar', {
		length: 16,
		nullable: true,
		comment: 'Rendered before the value (e.g. `class`)',
	})
	prefix!: string | null;

	// For decoration a `MeasureUnit` does not cover - `pcs`, `%`. A measurement uses `unit`
	// instead, which converts; this one is a label and does not
	@Column('varchar', {
		length: 16,
		nullable: true,
		comment: 'Rendered after the value when no `unit` applies',
	})
	suffix!: string | null;

	// Expressed in `unit`, like the values they bound - the service converts both through the same
	// factor before comparing
	@Column('decimal', {
		precision: 14,
		scale: 4,
		nullable: true,
		transformer: numericTransformer,
		comment: 'Lowest accepted value; numeric attributes only',
	})
	min_value!: number | null;

	@Column('decimal', {
		precision: 14,
		scale: 4,
		nullable: true,
		transformer: numericTransformer,
		comment: 'Highest accepted value; numeric attributes only',
	})
	max_value!: number | null;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'Whether a product in this category must supply the attribute',
	})
	is_required!: boolean;

	/**
	 * Whether the attribute is offered as a catalog filter. The facet indexes on the attribute
	 * tables cover every row regardless - this decides what the storefront exposes, not what the
	 * database can answer.
	 */
	@Column('boolean', {
		nullable: false,
		default: false,
	})
	is_filterable!: boolean;

	/**
	 * Whether descendant categories inherit the definition. A category's own definitions always
	 * apply; this only governs the walk up the tree, and a child defining the same label overrides
	 * the ancestor rather than adding to it.
	 */
	@Column('boolean', {
		nullable: false,
		default: true,
	})
	inherit!: boolean;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Display order within the category',
	})
	sort_order!: number;

	// RELATIONS
	@ManyToOne('CategoryEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'category_id' })
	category!: CategoryEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'attribute_label_id' })
	attribute_label!: TermEntity;

	// Populated only while `value_type` is `term`
	@OneToMany(
		'ProductCategoryAttributeOptionEntity',
		(option: ProductCategoryAttributeOptionEntity) => option.attribute,
	)
	options?: ProductCategoryAttributeOptionEntity[];
}
