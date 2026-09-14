import OrderEntity from '@/features/order/order.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class OrderPolicy extends PolicyAbstract {
	constructor() {
		const entity = OrderEntity.NAME;

		super(entity);
	}
}

export const orderPolicy = new OrderPolicy();
