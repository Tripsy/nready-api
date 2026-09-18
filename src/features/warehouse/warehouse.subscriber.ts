import { EventSubscriber } from 'typeorm';
import WarehouseEntity from '@/features/warehouse/warehouse.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';

@EventSubscriber()
export class WarehouseSubscriber extends SubscriberAbstract<WarehouseEntity> {
	protected readonly Entity = WarehouseEntity;

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
