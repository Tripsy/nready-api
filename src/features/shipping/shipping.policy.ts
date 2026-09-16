import ShippingEntity from '@/features/shipping/shipping.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class ShippingPolicy extends PolicyAbstract {
	constructor() {
		const entity = ShippingEntity.NAME;

		super(entity);
	}
}

export const shippingPolicy = new ShippingPolicy();
