import { OrderStatusEnum } from '@/features/order/order.entity';
import { orderService } from '@/features/order/order.service';
import {
	type CashFlowSettledPayload,
	registerCashFlowSettledHandler,
} from '@/shared/registries/order-settlement.registry';

/**
 * Confirms the order a captured customer payment was raised for.
 *
 * This is the shop's happy path: a checkout asks for the money before the business commits to
 * anything, and the payment landing is what accepts the order. The operator's own `statusUpdate`
 * route still confirms by hand - that is the back-office path, and the one cash-on-delivery takes
 * while the courier is still out.
 *
 * **Only a `pending` order is moved.** Anything else has already been resolved by somebody:
 * an operator who confirmed it before the gateway called back, or a cancellation that now has a
 * payment to refund. `assertValidStatusTransition` would refuse the move anyway, but refusing it
 * here keeps a routine race out of the error log, since the payment itself is committed and there
 * is nothing left to undo.
 *
 * Registered here rather than called from `cash-flow`: the ledger carries no document coupling,
 * and the order is named to it only as an `operational_record` id.
 */
export default function registerOrderBootstrap() {
	registerCashFlowSettledHandler(async (payload: CashFlowSettledPayload) => {
		const order = await orderService.findById(payload.order_id, false);

		if (order.status !== OrderStatusEnum.PENDING) {
			return;
		}

		// The movement travels with the confirmation so the charge raised downstream is settled
		// by the money that caused it, rather than standing `unpaid` beside it
		await orderService.updateStatus(
			order,
			OrderStatusEnum.CONFIRMED,
			payload.cash_flow_id,
		);
	});
}
