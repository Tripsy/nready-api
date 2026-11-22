import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type OrderReturnEntity from '@/features/order-return/order-return.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'order_return_line';

/**
 * What the buyer asks to send back, by variant and quantity - the shape `shipping_line` has, since
 * approving copies these lines onto the return movement as they stand.
 *
 * Named by variant, not order line, for the reason shipping is: what can come back is what was
 * delivered, and deliveries are counted per variant. A bundle comes back as its components - the
 * header never travelled.
 *
 * These are the request. What actually arrived, and in what condition, is the return movement's
 * lines - the warehouse may correct them on inspection, and the refund is drafted from them.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'What a return asks to send back, by variant and quantity',
})
@Index('IDX_order_return_line_unique', ['order_return_id', 'variant_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
@Check(`(quantity > 0)`)
export default class OrderReturnLineEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	order_return_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_order_return_line_variant_id')
	variant_id!: number;

	@Column('int', { nullable: false })
	product_id!: number;

	// `numeric` for the reason `shipping_line.quantity` is: `kg` and `litre` units exist
	@Column('numeric', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	quantity!: number;

	// RELATIONS
	@ManyToOne('OrderReturnEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'order_return_id' })
	order_return!: OrderReturnEntity;

	// Composite, like `shipping_line`: a variant of another product is refused by the database
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn([
		{ name: 'variant_id', referencedColumnName: 'id' },
		{ name: 'product_id', referencedColumnName: 'product_id' },
	])
	variant!: ProductVariantEntity;
}
