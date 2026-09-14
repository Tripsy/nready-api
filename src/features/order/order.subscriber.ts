import { EventSubscriber } from 'typeorm';
import OrderEntity from '@/features/order/order.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

/**
 * History for the document itself, not for its lines. `order_line` rows are written and
 * replaced as a set - editing a pending order swaps all of them - so an entry per line would bury the one
 * event a reader is looking for: what happened to the order.
 */
@EventSubscriber()
export class OrderSubscriber extends SubscriberAbstract<OrderEntity> {
	protected readonly Entity = OrderEntity;

	constructor() {
		super();

		this.config = {
			afterInsert: true,
			afterUpdate: true,
			beforeRemove: true,
			afterSoftRemove: true,
		};
	}
}
