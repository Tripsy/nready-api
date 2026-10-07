import { orderSettlementService } from '@/features/order-settlement/order-settlement.service';
import {
	type OrderStateChangedPayload,
	registerOrderStateChangedHandler,
} from '@/shared/registries/order-settlement.registry';

/**
 * Re-reads every order `invoice` announces - a document raised or paid, a payment allocated, a
 * delivery moved along - and moves it to the status its documents and deliveries justify. See
 * `order-settlement.registry.ts` for where this sits in the chain.
 */
export default function registerOrderSettlementBootstrap() {
	registerOrderStateChangedHandler(
		async (payload: OrderStateChangedPayload) => {
			await orderSettlementService.evaluateMany(payload.order_ids);
		},
	);
}
