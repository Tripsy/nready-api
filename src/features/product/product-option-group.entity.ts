import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import type ProductEntity from '@/features/product/product.entity';
import type ProductOptionEntity from '@/features/product/product-option.entity';
import type TermEntity from '@/features/term/term.entity';

const ENTITY_TABLE_NAME = 'product_option_group';

/**
 * A question asked at order time - "choose a side", "extras" - whose answers are the rows in
 * `product_option`.
 *
 * Distinct from a variant: a variant is a different thing to sell, with its own SKU and price
 * row, while an option modifies the thing being sold by a delta. Large vs small pizza is a
 * variant; extra bacon is an option.
 *
 * How many answers are accepted is expressed only as `min_select` / `max_select`. There is no
 * `is_required` flag and no single/multiple enum on purpose: both would have to agree with the
 * bounds, and the pair that drifts is the one nobody notices. Required means `min_select >= 1`,
 * single-choice means `max_select = 1`.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'A choice offered on a product at order time; the answers live in product-option.entity',
})
@Index('IDX_product_option_group_product_id', ['product_id', 'position'])
@Index('IDX_product_option_group_label_id', ['label_id'])
@Check(`(min_select >= 0)`)
@Check(`(max_select IS NULL OR max_select >= min_select)`)
// Not `EntityAbstract`: this table carries no `deleted_at`, like the two levels below it. A group
// is written only through the product form's Options tab, and dropping it from that form deletes
// it outright - taking its answers and their deltas with it through the cascades
export default class ProductOptionGroupEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@Column('int', { nullable: false })
	product_id!: number;

	@Column('int', {
		nullable: false,
		comment: 'Term holding the multilingual prompt, e.g. "Choose a side"',
	})
	label_id!: number;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Answers that must be chosen; 0 makes the group optional',
	})
	min_select!: number;

	@Column('int', {
		nullable: true,
		comment: 'Answers that may be chosen; NULL means no upper bound',
	})
	max_select!: number | null;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Display order within the product',
	})
	position!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

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

	@OneToMany(
		'ProductOptionEntity',
		(option: ProductOptionEntity) => option.option_group,
	)
	options?: ProductOptionEntity[];
}
