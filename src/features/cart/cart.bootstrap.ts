import type { EntityManager } from 'typeorm';
import CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { registerOrderPaymentSync } from '@/features/order/order.hooks';
import { shippingService } from '@/features/shipping/shipping.service';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';

/**
 * Keeps the payment request a checkout raised in step with the order it was raised for.
 *
 * A checkout asks for the money before anybody accepts the order, and an operator may still edit
 * a pending order - so when its lines are rewritten, the request still `pending` is restated at
 * what the order now costs (`CashFlowService.restatePendingForOrder`), inside the same transaction.
 * Money already captured is never touched: a shortfall leaves the order pending for the operator,
 * and an overpayment stays with the client as credit, spread over their documents by FIFO.
 *
 * Registered here because `cart` raised the request and already depends on `order`, `cash-flow`
 * and `shipping`; `order` cannot import any of them.
 */
export default function registerCartBootstrap() {
	registerOrderPaymentSync(
		async (manager: EntityManager, orderId: number) => {
			const payable = await shippingService.computeOrderPayable(
				orderId,
				manager,
			);

			const restated = await cashFlowService.restatePendingForOrder(
				manager,
				orderId,
				payable,
			);

			return restated === null
				? null
				: () => cleanEntityCache(CashFlowEntity, restated);
		},
	);
}
