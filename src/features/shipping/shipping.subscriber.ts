import { EventSubscriber } from 'typeorm';
import ShippingEntity from '@/features/shipping/shipping.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

@EventSubscriber()
export class ShippingSubscriber extends SubscriberAbstract<ShippingEntity> {
	protected readonly Entity = ShippingEntity;

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
