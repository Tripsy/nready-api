import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import type TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_variant_attribute';

/**
 * What distinguishes one variant from its siblings - size `large`, color `blue`. Same value shape
 * as `product_attribute` - one term-backed column and three scalar ones, exactly one filled - with
 * one deliberate difference: the unique key stops at the label, so a variant holds exactly one
 * value per axis. A product may legitimately list three allergens under the same label; a variant
 * cannot be both `large` and `small`.
 *
 * The axes a variant is expected to carry are declared the same way a product's attributes are, by
 * a `product_category_attribute` row on the product's category whose `scope` is `variant`. Numbers
 * are stored bare here too - a `32 cm` size axis is `32` under a definition whose suffix is `cm` -
 * so variants can be filtered by range on the same terms as products.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'The axis values that define a variant, using multilingual terms',
})
@Index(
	'IDX_product_variant_attribute_unique',
	['variant_id', 'attribute_label_id'],
	{
		unique: true,
		where: 'deleted_at IS NULL',
	},
)
// Facet indexes, matching `product_attribute`: leading on the label because a filter always names
// one, carrying `variant_id` so the scan answers from the index alone, partial so each holds only
// the rows of its shape
@Index(
	'IDX_product_variant_attribute_numeric_facet',
	['attribute_label_id', 'value_base', 'variant_id'],
	{
		where: 'value_base IS NOT NULL AND deleted_at IS NULL',
	},
)
@Index(
	'IDX_product_variant_attribute_term_facet',
	['attribute_label_id', 'value_term_id', 'variant_id'],
	{
		where: 'value_term_id IS NOT NULL AND deleted_at IS NULL',
	},
)
// An attribute row that says nothing, or says two things, is not a state the application should
// have to interpret on read. `value_base` is excluded from the count - it is the normalized form of
// `value_numeric`, not a fifth kind of value - and the second clause ties the two together
@Check(`
	(
		(value_term_id IS NOT NULL)::int
		+ (value_numeric IS NOT NULL)::int
		+ (value_text IS NOT NULL)::int
		+ (value_boolean IS NOT NULL)::int
	) = 1
	AND (value_numeric IS NULL) = (value_base IS NULL)
`)
export default class ProductVariantAttributeEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	/*
	 * Non-partial on purpose. `ProductVariantRepository.syncAttributes` reads this key with `withDeleted`, so it can revive a
	 * row rather than collide with the partial unique index, and no index carrying
	 * `WHERE deleted_at IS NULL` answers a query that does not say it. The foreign key's cascade
	 * looks the children up the same way.
	 */
	@Column('uuid', { nullable: false })
	@Index('IDX_product_variant_attribute_variant_id')
	variant_id!: EntityId;

	// Both indexed for the cascade `term` triggers on delete - Postgres looks the children up by
	// each key separately, the label is not a prefix of the unique index, and the facet indexes
	// lead on the label rather than the value
	@Column('uuid', { nullable: false })
	@Index('IDX_product_variant_attribute_label_id')
	attribute_label_id!: EntityId;

	// Nullable since the value may instead be a literal in one of the three columns below
	@Column('uuid', { nullable: true })
	@Index('IDX_product_variant_attribute_value_id')
	value_term_id!: EntityId | null;

	@Column('decimal', {
		precision: 14,
		scale: 4,
		nullable: true,
		transformer: numericTransformer,
		comment:
			'Bare measurement as entered; the unit comes from the definition',
	})
	value_numeric!: number | null;

	// `value_numeric` converted into its dimension's base unit by `toBaseUnit`, or a copy of it
	// when the definition names no unit. Derived, never supplied by a payload, and wider than its
	// source because converting upward multiplies. See `ProductAttributeEntity`
	@Column('decimal', {
		precision: 20,
		scale: 6,
		nullable: true,
		transformer: numericTransformer,
		comment: 'Normalized measurement; what range filters compare',
	})
	value_base!: number | null;

	// 255 to match `term_content.value`, so promoting a label from literals to shared terms never
	// has to truncate what is already recorded
	@Column('varchar', {
		length: 255,
		nullable: true,
	})
	value_text!: string | null;

	@Column('boolean', {
		nullable: true,
	})
	value_boolean!: boolean | null;

	// RELATIONS
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'variant_id' })
	variant!: ProductVariantEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'attribute_label_id' })
	attribute_label!: TermEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	@JoinColumn({ name: 'value_term_id' })
	attribute_value!: TermEntity | null;
}
