import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductCategoryAttributeEntity from '@/features/product/product-category-attribute.entity';
import type TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_category_attribute_option';

/**
 * One admissible value for a list-backed attribute definition - the *red* in *red, blue, white*.
 *
 * A row rather than a string in a `jsonb` column, because the option is a `term` of type
 * `attribute_value` and that buys three things a literal cannot: the wording renders per language
 * from `term_content`, two categories offering the same list point at the same records, and
 * renaming the term corrects every product already carrying it. The product stores the same
 * `term_id` in `product_attribute.value_term_id`, so the option list and the recorded value are the
 * same vocabulary rather than two spellings that have to agree.
 *
 * A numeric attribute has no option rows. Its restriction is `min_value` / `max_value` on the
 * definition - a range, which is what a measurement is bounded by, and which leaves the number in
 * `value_numeric` where it stays filterable. A dropdown of allowed numbers would put the value back
 * in a `term` and forfeit that; see `.claude/rules/product.md` §12.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'One admissible value for a list-backed product category attribute',
})
// Every option for a definition, in offer order. Leading on `attribute_id` also serves the cascade
// the definition's delete triggers, and `ProductCategoryAttributeRepository.syncOptions`, which
// reads the same key with `withDeleted` - the reason it carries no `deleted_at IS NULL` predicate,
// since a partial index answers neither
@Index('IDX_product_category_attribute_option_attribute_id', [
	'attribute_id',
	'sort_order',
])
@Index(
	'IDX_product_category_attribute_option_unique',
	['attribute_id', 'term_id'],
	{
		unique: true,
		where: 'deleted_at IS NULL',
	},
)
export default class ProductCategoryAttributeOptionEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	// No index of its own: leftmost column of both indexes above
	@Column('uuid', { nullable: false })
	attribute_id!: EntityId;

	// Indexed for the cascade `term` triggers on delete - it is not a prefix of either index
	@Column('uuid', { nullable: false })
	@Index('IDX_product_category_attribute_option_term_id')
	term_id!: EntityId;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Order the option is offered in',
	})
	sort_order!: number;

	// RELATIONS
	@ManyToOne('ProductCategoryAttributeEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'attribute_id' })
	attribute!: ProductCategoryAttributeEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'term_id' })
	term!: TermEntity;
}
