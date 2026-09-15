import {
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
import type ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import type ProductOptionPriceEntity from '@/features/product/product-option-price.entity';
import type TermEntity from '@/features/term/term.entity';

/**
 * What an order line records about a chosen option. Frozen at the moment of ordering, like
 * `DiscountSnapshot`: the option row may be renamed, repriced or withdrawn afterwards, and the
 * line still has to add up to what was charged.
 */
export type ProductOptionSnapshot = {
	/**
	 * The `product_option` the snapshot was taken from, so an editor can send the choice back as
	 * an id. Optional: snapshots written before it was recorded carry only the wording.
	 */
	option_id?: number;
	label: string;
	price_delta: number;
	currency: string;
};

const ENTITY_TABLE_NAME = 'product_option';

/**
 * One answer to the question its group asks. The price effect is a *delta* against the variant
 * price, held per currency in `product-option-price.entity` - negative is allowed, so "no cheese,
 * -2" is expressible.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'An answer within a product option group; priced as a delta',
})
@Index('IDX_product_option_group_id', ['option_group_id', 'position'])
@Index('IDX_product_option_label_id', ['label_id'])
// At most one preselected answer per group, mirroring the default-variant rule
@Index('IDX_product_option_default', ['option_group_id'], {
	unique: true,
	where: 'is_default = true',
})
// Not `EntityAbstract`: this table carries no `deleted_at`. An option has no CRUD surface of its
// own - it is written only through the product form's Options tab - and `syncOptions` deletes an
// answer dropped from that form outright, so there is no soft-deleted state to read or restore
export default class ProductOptionEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@Column('int', { nullable: false })
	option_group_id!: number;

	@Column('int', {
		nullable: false,
		comment: 'Term holding the multilingual answer, e.g. "Extra bacon"',
	})
	label_id!: number;

	@Column('int', {
		nullable: false,
		default: 0,
		comment: 'Display order within the group',
	})
	position!: number;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'Preselected when the customer has not chosen',
	})
	is_default!: boolean;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	// RELATIONS
	@ManyToOne('ProductOptionGroupEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'option_group_id' })
	option_group!: ProductOptionGroupEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'label_id' })
	label!: TermEntity;

	@OneToMany(
		'ProductOptionPriceEntity',
		(price: ProductOptionPriceEntity) => price.option,
	)
	prices?: ProductOptionPriceEntity[];
}
