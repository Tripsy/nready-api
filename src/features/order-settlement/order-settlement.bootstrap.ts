import {
	type OrderStateChangedPayload,
	registerOrderStateChangedHandler,
} from '@/features/invoice/invoice.hooks';
import { orderSettlementService } from '@/features/order-settlement/order-settlement.service';

/**
 * Re-reads every order `invoice` announces - a document raised or paid, a payment allocated, a
 * delivery moved along - and moves it to the status its documents and deliveries justify. See
 * `invoice.hooks.ts` for where this sits in the chain.
 */
export default function registerOrderSettlementBootstrap() {
	registerOrderStateChangedHandler(
		async (payload: OrderStateChangedPayload) => {
			await orderSettlementService.evaluateMany(payload.order_ids);
		},
	);
}
