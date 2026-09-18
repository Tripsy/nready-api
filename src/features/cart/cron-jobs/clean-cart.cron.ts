import { cartService } from '@/features/cart/cart.service';

// Hourly, off the hour so it does not compete with the sweeps scheduled at :00. Expiry is measured
// in days, so the exact minute a cart is swept does not matter - only that nothing sits expired
// long enough to be quoted stale prices from.
export const SCHEDULE_EXPRESSION = '17 * * * *';
export const EXPECTED_RUN_TIME = 5; // seconds

/**
 * Deletes carts nobody came back to.
 *
 * One step, because a cart is not a document: it holds references and no money, so an expired
 * basket has nothing worth keeping past its expiry and no intermediate state to pass through
 * first. The lines go with it through the `cart_item.cart_id` cascade.
 */
const cleanCart = async () => {
	return cartService.cleanUp();
};

export default cleanCart;
