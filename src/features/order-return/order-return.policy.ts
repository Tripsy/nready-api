import OrderReturnEntity from '@/features/order-return/order-return.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class OrderReturnPolicy extends PolicyAbstract {
	constructor() {
		const entity = OrderReturnEntity.NAME;

		super(entity);
	}
}

export const orderReturnPolicy = new OrderReturnPolicy();
