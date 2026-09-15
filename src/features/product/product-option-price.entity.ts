import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import type ProductOptionEntity from '@/features/product/product-option.entity';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'product_option_price';

/**
 * Per currency, like `product_price`, rather than a single amount on the option.
 *
 * A delta carries a currency whether or not a column says so: adding a `price_delta` of 3 to a
 * price quoted in EUR is only right if the 3 is EUR. Storing one figure for every market makes
 * that mismatch silent and wrong in the line total, which is the one place an error compounds.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Per-currency price delta for a product option; excludes VAT, like product-price.entity',
})
@Index('IDX_product_option_price_unique', ['option_id', 'currency'], {
	unique: true,
})
// Not `EntityAbstract`: this table carries no `deleted_at`, like the two levels above it. A delta
// is written only through the product form's Options tab, and is deleted outright when its
// currency is dropped from that form or its option goes
export default class ProductOptionPriceEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	/*
	 * Duplicates the leading column of `IDX_product_option_price_unique`, which is unconditional
	 * and answers a lookup by `option_id` alone - so this one earns its place on nothing but the
	 * `option_id` foreign key's cascade, and dropping it should be a decision of its own.
	 */
	@Column('int', { nullable: false })
	@Index('IDX_product_option_price_option_id')
	option_id!: number;

	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
	})
	currency!: string;

	// No positivity check, unlike `product_price.price` - a discount for leaving something out is
	// a normal answer, so the delta is signed
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Added to the variant price; negative subtracts',
		transformer: numericTransformer,
	})
	price_delta!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	// RELATIONS
	@ManyToOne('ProductOptionEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'option_id' })
	option!: ProductOptionEntity;
}
