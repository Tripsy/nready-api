import { EventSubscriber } from 'typeorm';
import VatRateEntity from '@/features/vat-rate/vat-rate.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

@EventSubscriber()
export class VatRateSubscriber extends SubscriberAbstract<VatRateEntity> {
	protected readonly Entity = VatRateEntity;

	constructor() {
		super();

		this.config = {
			afterInsert: true,
			afterUpdate: true,
			beforeRemove: true,
		};
	}
}
