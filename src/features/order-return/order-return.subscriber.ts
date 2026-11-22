import { EventSubscriber } from 'typeorm';
import OrderReturnEntity from '@/features/order-return/order-return.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

@EventSubscriber()
export class OrderReturnSubscriber extends SubscriberAbstract<OrderReturnEntity> {
	protected readonly Entity = OrderReturnEntity;

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
