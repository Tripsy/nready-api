import OrderEntity from '@/features/order/order.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';
import type { AuthContext } from '@/shared/types/express';

export class OrderPolicy extends PolicyAbstract {
	constructor() {
		const entity = OrderEntity.NAME;

		super(entity);
	}

	/**
	 * Whether the caller may type a discount on a back-office document - an admin, or an operator
	 * holding `order.discount`.
	 *
	 * A boolean rather than a throwing `can*`: lacking it does not refuse the request outright.
	 * `OrderService` refuses only a payload that sets, changes or clears a typed discount, so an
	 * operator without it can still edit an order somebody else discounted.
	 */
	public mayDiscount(auth: AuthContext): boolean {
		return (
			this.isAdmin(auth) ||
			this.hasPermission(auth, this.entity, 'discount')
		);
	}
}

export const orderPolicy = new OrderPolicy();
