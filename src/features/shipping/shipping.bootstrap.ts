import type { EntityManager } from 'typeorm';
import {
	type OrderCanceledPayload,
	type OrderConfirmedPayload,
	registerOrderCanceledHandler,
	registerOrderDeliverySync,
	registerOrderFulfillmentHandler,
} from '@/features/order/order.hooks';
import ShippingEntity from '@/features/shipping/shipping.entity';
import { shippingService } from '@/features/shipping/shipping.service';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';

/**
 * Follows an order's fate with its deliveries:
 *
 * - **Accepted** - its deliveries still `pending` move to `preparing`, whichever path confirmed
 *   it: a covering payment or an operator.
 * - **Canceled** - its deliveries that have not left move to `canceled`, whoever canceled it: the
 *   buyer or an operator.
 * - **Lines rewritten** (a pending order edited) - its one delivery not yet shipped is re-listed
 *   with the order's goods, inside the edit's transaction (`ShippingService.syncLinesForOrder`).
 *
 * Registered rather than called because `shipping` already depends on `order`, which cannot
 * import back. The first two run after the order's write has committed; a delivery that fails to
 * move is logged and left where it was for the operator, and the order keeps its new status. The
 * re-listing runs inside it, so a failure there rolls the line edit back.
 */
export default function registerShippingBootstrap() {
	registerOrderFulfillmentHandler(async (payload: OrderConfirmedPayload) => {
		await shippingService.prepareForOrder(payload.order_id);
	});

	registerOrderCanceledHandler(async (payload: OrderCanceledPayload) => {
		await shippingService.cancelForOrder(payload.order_id);
	});

	registerOrderDeliverySync(
		async (manager: EntityManager, orderId: number) => {
			const synced = await shippingService.syncLinesForOrder(
				manager,
				orderId,
			);

			return synced === null
				? null
				: () => cleanEntityCache(ShippingEntity, synced);
		},
	);
}
