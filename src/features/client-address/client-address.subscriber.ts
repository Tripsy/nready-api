import { EventSubscriber } from 'typeorm';
import ClientAddressEntity from '@/features/client-address/client-address.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

/**
 * No `afterSoftRemove`: the table has no `deleted_at`, so a removal is always `beforeRemove`.
 */
@EventSubscriber()
export class ClientAddressSubscriber extends SubscriberAbstract<ClientAddressEntity> {
	protected readonly Entity = ClientAddressEntity;

	constructor() {
		super();

		this.config = {
			afterInsert: true,
			afterUpdate: true,
			beforeRemove: true,
		};
	}
}
