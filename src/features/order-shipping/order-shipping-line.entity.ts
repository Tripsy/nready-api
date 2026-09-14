import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type OrderLineEntity from '@/features/order/order-line.entity';
import type OrderShippingEntity from '@/features/order-shipping/order-shipping.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

const ENTITY_TABLE_NAME = 'order_shipping_line';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Allocation of order lines to specific shipments',
})
@Index(
	'IDX_order_shipping_line_unique',
	['order_shipping_id', 'order_line_id'],
	{
		unique: true,
		where: 'deleted_at IS NULL',
	},
)
@Check(`(quantity > 0)`)
export default class OrderShippingLineEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_order_shipping_line_order_line_id')
	order_line_id!: number;

	@Column('int', { nullable: false })
	order_shipping_id!: number;

	@Column('numeric', { precision: 12, scale: 2, nullable: false })
	quantity!: number;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('OrderLineEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'order_line_id' })
	order_line!: OrderLineEntity;

	@ManyToOne('OrderShippingEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'order_shipping_id' })
	order_shipping!: OrderShippingEntity;
}
