import { orderReturnService } from '@/features/order-return/order-return.service';
import { registerReturnReceivedHandler } from '@/features/shipping/shipping.hooks';

/**
 * Follows a return's movement to its warehouse: once it arrives, the return document it carries
 * moves to `received` and its refund is drafted (`OrderReturnService.receiveForMovement`).
 *
 * Registered rather than called because `order-return` depends on `shipping`, which cannot import
 * back. It runs after the movement's status has committed - the stock is already in by then - so
 * a failure here is logged and leaves the return `approved` for the operator, with the goods
 * received regardless.
 */
export default function registerOrderReturnBootstrap() {
	registerReturnReceivedHandler(async (payload) => {
		await orderReturnService.receiveForMovement(payload.shipping_id);
	});
}
