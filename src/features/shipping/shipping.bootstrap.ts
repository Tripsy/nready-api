import {
	type OrderConfirmedPayload,
	registerOrderFulfillmentHandler,
} from '@/features/order/order.hooks';
import { shippingService } from '@/features/shipping/shipping.service';

/**
 * Starts preparing an order's goods once it is accepted: its deliveries still `pending` move to
 * `preparing`, whichever path confirmed it - a covering payment or an operator.
 *
 * Registered rather than called because `shipping` already depends on `order`, which cannot
 * import back. Runs after the confirmation has committed; a delivery that fails to move is logged
 * and left `pending` for the operator, and the order stays confirmed.
 */
export default function registerShippingBootstrap() {
	registerOrderFulfillmentHandler(async (payload: OrderConfirmedPayload) => {
		await shippingService.prepareForOrder(payload.order_id);
	});
}
