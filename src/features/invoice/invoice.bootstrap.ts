import { invoiceService } from '@/features/invoice/invoice.service';
import { invoiceSettlementService } from '@/features/invoice/invoice-settlement.service';
import { InvoiceSourceTypeEnum } from '@/features/invoice/invoice-source.entity';
import {
	type CashFlowCompletedPayload,
	notifyOrderStateChanged,
	type OrderConfirmedPayload,
	type OrderPlacedPayload,
	registerCashFlowCompletedHandler,
	registerOrderConfirmedHandler,
	registerOrderInvoicedResolver,
	registerOrderPlacedHandler,
	registerShippingChangedHandler,
	type ShippingChangedPayload,
} from '@/shared/registries/order-settlement.registry';

/**
 * Bills orders and spreads the money clients pay over their documents - the billing half of
 * `order-settlement.registry.ts`, which says the direction the chain runs in and what a failure
 * leaves behind.
 *
 * Registered rather than called: `invoice` already imports `order` and `cash-flow`, so neither
 * can import back without closing a cycle; a movement is billed through the provider `shipping`
 * registers in `billable-source.registry.ts`. Every handler ends by announcing the orders it
 * touched (`notifyOrderStateChanged`), for `order-settlement` to move along when installed.
 *
 * - **Order placed** (checkout) - the goods and the delivery are billed at once, and whatever the
 *   client already holds with the business is spread over them.
 * - **Cash flow completed** - money coming in is spread over the client's open documents oldest
 *   first. The ledger entry is written by `cash-flow` itself, in the completing transaction.
 * - **Order confirmed** - whatever is still unbilled is billed. On the checkout path that is
 *   nothing; on the back-office path it is the whole order.
 * - **Shipping changed** - a priced movement added to an order already billed is billed in turn,
 *   and the order is announced either way, since a delivery arriving is what completes it.
 *
 * A billing document refused over the buyer's details - a billing address deleted between
 * checkout and now - leaves the order standing with nothing billed, for the operator to raise once
 * the client is fixed.
 */
export default function registerInvoiceBootstrap() {
	registerOrderInvoicedResolver((orderId: number) =>
		invoiceService.hasLiveOrderInvoice(orderId),
	);

	registerOrderPlacedHandler(async (payload: OrderPlacedPayload) => {
		const raised = await invoiceService.raiseForOrderDocuments(
			payload.order_id,
		);

		await invoiceSettlementService.afterIssued(raised);
	});

	registerCashFlowCompletedHandler(
		async (payload: CashFlowCompletedPayload) => {
			await invoiceSettlementService.onCashFlowCompleted(
				payload.cash_flow_id,
			);
		},
	);

	registerOrderConfirmedHandler(async (payload: OrderConfirmedPayload) => {
		const raised = await invoiceService.raiseForOrderDocuments(
			payload.order_id,
		);

		await invoiceSettlementService.afterIssued(raised);
	});

	registerShippingChangedHandler(async (payload: ShippingChangedPayload) => {
		if (!payload.order_id) {
			return;
		}

		// Only an order whose goods are already billed has its later movements billed here: an
		// order nobody has billed yet is billed whole when it is placed or confirmed
		if (await invoiceService.hasLiveOrderInvoice(payload.order_id)) {
			const raised = await invoiceService.raiseForSource(
				InvoiceSourceTypeEnum.SHIPPING,
				payload.shipping_id,
			);

			if (raised) {
				await invoiceSettlementService.afterIssued([raised]);
			}
		}

		// A delivery arriving is what completes an order, so it is announced whatever was billed
		await notifyOrderStateChanged({ order_ids: [payload.order_id] });
	});
}
