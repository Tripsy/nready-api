import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductEntity from '@/features/product/product.entity';
import type TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_attribute';

/**
 * What a product says about itself under a given label.
 *
 * The value lives in one of four columns, picked by the `value_type` of the
 * `product_category_attribute` definition that governs the label:
 *
 * | Source | Column |
 * |---|---|
 * | Taxonomy value shared across products | `value_term_id` |
 * | `number` | `value_numeric` |
 * | `string` | `value_text` |
 * | `boolean` | `value_boolean` |
 *
 * A number is stored bare - `330`, not `330 ml`. The unit is fixed by the definition and rendered
 * at read time, which is what lets a range query run against an indexed numeric column.
 * `value_numeric` keeps the figure as entered, for display; `value_base` carries it converted into
 * the dimension's base unit, and that is what filters compare. Storing both is what lets one
 * category quote a label in `ml` and another in `l` without a range spanning them going wrong.
 *
 * `value_term_id` is not a legacy of the other three. A term-backed value is a row other products
 * point at too, so renaming *Gluten* corrects every product at once and the Romanian catalog reads
 * from the same record as the English one; the scalar columns hold literals owned by this row
 * alone. Reach for the term whenever the value is a shared vocabulary rather than a measurement.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Key/value attributes for products, using multilingual terms',
})
/**
 * Uniqueness splits in two, because the rule genuinely differs by value shape and a single key
 * cannot say both. A nullable `value_term_id` inside one unique index would say neither: Postgres
 * counts every NULL as distinct, so scalar rows would go entirely unconstrained.
 *
 * - Term-backed rows differ in `value_term_id`, so a product may list three allergens under one
 *   label - the cardinality `product_variant_attribute` deliberately forbids for itself.
 * - Scalar rows are keyed on the label alone, so it admits exactly one number, string or boolean
 *   per product. That is the right rule: a product has one volume.
 *
 * A multi-pick `checkbox` over a `string` list therefore cannot be one row per choice. It is a
 * single row whose `value_text` holds the joined selection, or a label promoted to term-backed
 * values.
 */
@Index(
	'IDX_product_attribute_unique',
	['product_id', 'attribute_label_id', 'value_term_id'],
	{
		unique: true,
		where: 'value_term_id IS NOT NULL AND deleted_at IS NULL',
	},
)
@Index(
	'IDX_product_attribute_unique_scalar',
	['product_id', 'attribute_label_id'],
	{
		unique: true,
		where: 'value_term_id IS NULL AND deleted_at IS NULL',
	},
)
// Facet indexes - one per filterable value shape, each leading on the label because a filter always
// names one ("volume between 300 and 600"), and each carrying `product_id` so the scan answers from
// the index alone. Partial, so they hold only the rows of that shape rather than the whole table.
// `IDX_product_attribute_attribute_value_id` below cannot serve either: it leads on the value, so a
// filter naming a label has no prefix to seek on. It stays for the cascade triggers alone.
@Index(
	'IDX_product_attribute_numeric_facet',
	['attribute_label_id', 'value_base', 'product_id'],
	{
		where: 'value_base IS NOT NULL AND deleted_at IS NULL',
	},
)
@Index(
	'IDX_product_attribute_term_facet',
	['attribute_label_id', 'value_term_id', 'product_id'],
	{
		where: 'value_term_id IS NOT NULL AND deleted_at IS NULL',
	},
)
// An attribute row that says nothing, or says two things, is not a state the application should
// have to interpret on read. `value_base` is excluded from the count - it is not a fifth kind of
// value but the normalized form of `value_numeric`, and the second clause ties the two together so
// no row can be filterable without being displayable, or the reverse
@Check(`
	(
		(value_term_id IS NOT NULL)::int
		+ (value_numeric IS NOT NULL)::int
		+ (value_text IS NOT NULL)::int
		+ (value_boolean IS NOT NULL)::int
	) = 1
	AND (value_numeric IS NULL) = (value_base IS NULL)
`)
export default class ProductAttributeEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	/*
	 * Non-partial on purpose. `ProductAttributeRepository.syncValues` reads this key with `withDeleted`, so it can revive a
	 * row rather than collide with the partial unique index, and no index carrying
	 * `WHERE deleted_at IS NULL` answers a query that does not say it. The foreign key's cascade
	 * looks the children up the same way.
	 */
	@Column('uuid', { nullable: false })
	@Index('IDX_product_attribute_product_id')
	product_id!: EntityId;

	// Indexed for the cascade `term` triggers on delete - Postgres looks the children up by this
	// key on its own, and it is not a prefix of the unique index
	@Column('uuid', { nullable: false })
	@Index('IDX_product_attribute_attribute_label_id')
	attribute_label_id!: EntityId;

	// Nullable since a value may instead be a literal in one of the three columns below. Keeps its
	// own index for the same cascade reason as the label - the facet index leads on the label, so
	// it does not answer "which rows point at this term"
	@Column('uuid', { nullable: true })
	@Index('IDX_product_attribute_attribute_value_id')
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

	/**
	 * `value_numeric` converted into its dimension's base unit by `toBaseUnit`, or a copy of it
	 * when the definition names no unit - so every numeric attribute has one and a range filter
	 * needs no branch.
	 *
	 * Derived, never supplied by a payload, and written in the same statement as `value_numeric`.
	 * Wider than its source because converting upward multiplies: 5 t is 5,000,000 g, and a `kwh`
	 * figure reaches the millions of joules.
	 */
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
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;

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
