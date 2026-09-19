import { EventSubscriber } from 'typeorm';
import InvoiceEntity from '@/features/invoice/invoice.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

@EventSubscriber()
export class InvoiceSubscriber extends SubscriberAbstract<InvoiceEntity> {
	protected readonly Entity = InvoiceEntity;

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
