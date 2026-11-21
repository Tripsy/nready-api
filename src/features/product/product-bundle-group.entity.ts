import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type ProductEntity from '@/features/product/product.entity';
import type ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import type TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'product_bundle_group';

/**
 * A choice offered inside a bundle - "choose your fries" - whose candidates are the
 * `product_bundle_item` rows carrying its `group_id`. Exactly one of them is taken.
 *
 * This is the only thing in the schema that says **exactly one of these**. An optional component
 * outside a group is an independent tick box bounded by nothing but its own `quantity`, so two of
 * them can both be taken or both left.
 *
 * **No `min_select` / `max_select`, unlike `product_option_group`**, and this is the one place the
 * two shapes deliberately diverge. Such a bound would count candidate *rows*, while what a bundle
 * is measured in is units - every candidate carries its own `quantity` ceiling. So the one case
 * the pair would buy, a mixed pack of *n* units drawn from a list, is exactly the case it cannot
 * state: `max_select = 6` over rows whose ceiling is 2 permits twelve. Rather than keep two
 * columns nothing could read correctly, a bundle choice means one thing and says it in its shape.
 *
 * A group therefore needs **two** candidates to be a choice at all -
 * `ProductService.assertBundleGroupsAreUsable` refuses fewer. With one, "exactly one of these" is
 * just a component that is always included, wearing a prompt.
 *
 * Distinct from `product_option_group` in what a candidate is, too: an option's answer is a term -
 * a label with a delta and nothing behind it - where a candidate here is a variant, so the choice
 * decides what leaves stock and at which VAT rate. See `.claude/rules/product.md` §8.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'A choice offered inside a bundle; exactly one of its product-bundle-item candidates is taken',
})
// Rendering a bundle reads every group it has, in display order
@Index('IDX_product_bundle_group_product_id', ['product_id', 'position'])
@Index('IDX_product_bundle_group_label_id', ['label_id'])
export default class ProductBundleGroupEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', {
		nullable: false,
		comment: 'The bundle this choice belongs to',
	})
	product_id!: EntityId;

	@Column('uuid', {
		nullable: false,
		comment:
			'Term holding the multilingual prompt, e.g. "Choose your fries"',
	})
	label_id!: EntityId;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Display order within the bundle',
	})
	position!: number;

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'label_id' })
	label!: TermEntity;

	/*
	 * CASCADE from the group's side is a hard delete only; a soft-removed group leaves its
	 * candidates behind, which is why `assertBundleGroupsAreUsable` reads the pair back rather
	 * than trusting the sync.
	 */
	@OneToMany(
		'ProductBundleItemEntity',
		(item: ProductBundleItemEntity) => item.group,
	)
	items?: ProductBundleItemEntity[];
}
