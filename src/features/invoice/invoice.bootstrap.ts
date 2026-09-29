import { invoiceService } from '@/features/invoice/invoice.service';
import { invoicePaymentService } from '@/features/invoice/invoice-payment.service';
import {
	type OrderConfirmedPayload,
	registerOrderConfirmedHandler,
} from '@/shared/registries/order-settlement.registry';

/**
 * Raises the charge for an order that has just been accepted, and settles it with the money that
 * accepted it.
 *
 * Registered rather than called: `invoice` already imports `order`, so the order feature cannot
 * import back without closing a cycle. Registering also covers every path that confirms an order -
 * a captured payment as well as the operator's `statusUpdate` route.
 *
 * The two halves fail independently on purpose. Raising the document can be refused over the
 * buyer's own details - a billing address deleted between checkout and now leaves
 * `order.billing_address_id` null, since the key is `ON DELETE SET NULL` and `client_address` has
 * no soft delete - and the order stands regardless, with the charge raised by hand once the client
 * is fixed. Settling can be refused over a currency or a direction that does not line up, and an
 * issued invoice left `unpaid` beside a captured movement is a document an operator can allocate
 * from the invoice's own payment route.
 */
export default function registerInvoiceBootstrap() {
	registerOrderConfirmedHandler(async (payload: OrderConfirmedPayload) => {
		const invoice = await invoiceService.raiseForOrder(payload.order_id);

		// Null when a live charge already stands for this order - a repeated confirm, or a
		// document raised by hand before the payment landed. Either way there is nothing to settle
		// here: allocating against a charge this handler did not raise is the operator's call
		if (!invoice || !payload.cash_flow_id) {
			return;
		}

		await invoicePaymentService.settleFromCashFlow(
			invoice,
			payload.cash_flow_id,
		);
	});
}
