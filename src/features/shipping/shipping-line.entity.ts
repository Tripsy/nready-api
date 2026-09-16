import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import type ShippingEntity from '@/features/shipping/shipping.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'shipping_line';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'What physically travels in one movement, by variant and quantity',
})
// One row per variant in a movement: sending the same thing twice is a quantity, not a second line
@Index('IDX_shipping_line_unique', ['shipping_id', 'variant_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
@Check(`(quantity > 0)`)
export default class ShippingLineEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	shipping_id!: number;

	/**
	 * What travels, named by variant rather than by order line.
	 *
	 * A movement does not always have an order behind it - a `relocation` moves stock between two
	 * warehouses against a document that is not an order at all - so the line cannot hang off
	 * `order_line`. The variant is the one thing every scope shares, and it is also what a stock
	 * movement is posted against.
	 *
	 * The cost is that a `delivery` no longer points at the exact order line it satisfies. What the
	 * order still has unshipped is therefore answered by summing these quantities per variant across
	 * the order's movements, which `ShippingService` does when it validates an allocation.
	 *
	 * `product_id` travels alongside for the same reason it does on `order_line`: the pair is a
	 * **composite** foreign key, so a line naming a variant of another product is refused by the
	 * database rather than by a check somebody has to remember.
	 */
	@Column('int', { nullable: false })
	@Index('IDX_shipping_line_variant_id')
	variant_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_shipping_line_product_id')
	product_id!: number;

	/*
	 * `numeric` for the reason `order_line.quantity` is: `product.unit` allows `kg` and `litre`, so
	 * a line may legitimately read 0.75. The transformer keeps it a number - node-postgres hands a
	 * `numeric` over as a string otherwise.
	 */
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	quantity!: number;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('ShippingEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'shipping_id' })
	shipping!: ShippingEntity;

	// Composite, and RESTRICT: both columns are the key, and a variant that has physically moved
	// cannot be deleted out from under the ledger that recorded the movement
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn([
		{ name: 'variant_id', referencedColumnName: 'id' },
		{ name: 'product_id', referencedColumnName: 'product_id' },
	])
	variant!: ProductVariantEntity;
}
