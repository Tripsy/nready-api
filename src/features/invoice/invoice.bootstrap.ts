import {
	type CashFlowCompletedPayload,
	registerCashFlowCompletedHandler,
} from '@/features/cash-flow/cash-flow.hooks';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import {
	notifyOrderStateChanged,
	registerBillableSourceProvider,
} from '@/features/invoice/invoice.hooks';
import { invoiceService } from '@/features/invoice/invoice.service';
import { invoiceSettlementService } from '@/features/invoice/invoice-settlement.service';
import { InvoiceSourceTypeEnum } from '@/features/invoice/invoice-source.entity';
import { shippingBillableSource } from '@/features/invoice/sources/shipping.source';
import {
	type OrderConfirmedPayload,
	registerOrderClientLockedResolver,
	registerOrderConfirmedHandler,
	registerOrderInvoicedResolver,
} from '@/features/order/order.hooks';
import {
	registerShippingChangedHandler,
	type ShippingChangedPayload,
} from '@/features/shipping/shipping.hooks';

/**
 * Bills orders and spreads the money clients pay over their documents - the billing half of the
 * chain `invoice.hooks.ts` describes, with the direction it runs in and what a failure leaves
 * behind.
 *
 * Registered rather than called: `invoice` already imports `order`, `cash-flow` and `shipping`,
 * so none of them can import back without closing a cycle - each raises its hook from its own
 * `*.hooks.ts`, and this answers it. A movement is billed through `sources/shipping.source.ts`.
 * Every handler ends by announcing the orders it touched (`notifyOrderStateChanged`), for
 * `order-settlement` to move along when installed.
 *
 * - **Order placed** (checkout) - deliberately not answered. A pending order is still the
 *   operator's to edit, and an issued document could only be reversed, never rewritten - so
 *   nothing is billed until the order is confirmed.
 * - **Cash flow completed** - money coming in is spread over the client's open documents oldest
 *   first, and the order it was paid for is announced, so `order-settlement` can confirm an order
 *   its payment now covers. The ledger entry is written by `cash-flow` itself, in the completing
 *   transaction.
 * - **Order confirmed** - the goods and the delivery are billed, whichever path raised the order,
 *   and whatever the client already paid is spread over them.
 * - **Shipping changed** - a priced movement added to an order already billed is billed in turn,
 *   and the order is announced either way, since a delivery arriving is what completes it.
 *
 * A billing document refused over the buyer's details - a billing address deleted between
 * checkout and now - leaves the order standing with nothing billed, for the operator to raise once
 * the client is fixed.
 */
export default function registerInvoiceBootstrap() {
	registerBillableSourceProvider(
		InvoiceSourceTypeEnum.SHIPPING,
		shippingBillableSource,
	);

	registerOrderInvoicedResolver((orderId: number) =>
		invoiceService.hasLiveOrderInvoice(orderId),
	);

	// A document is raised for one client and a payment filed under one: either pins the order
	registerOrderClientLockedResolver(
		async (orderId: number) =>
			(await invoiceService.hasLiveOrderInvoice(orderId)) ||
			(await cashFlowService.hasMovementsForOrder(orderId)),
	);

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
		// order nobody has billed yet is billed whole when it is confirmed
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
