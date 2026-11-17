import { EventSubscriber } from 'typeorm';
import GrnEntity from '@/features/grn/grn.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

@EventSubscriber()
export class GrnSubscriber extends SubscriberAbstract<GrnEntity> {
	protected readonly Entity = GrnEntity;

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
