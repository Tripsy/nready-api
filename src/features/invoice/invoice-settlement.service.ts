import { CashFlowDirectionEnum } from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import type { InvoiceWithSources } from '@/features/invoice/invoice.entity';
import { invoiceService } from '@/features/invoice/invoice.service';
import { invoicePaymentService } from '@/features/invoice/invoice-payment.service';
import { notifyOrderStateChanged } from '@/shared/registries/order-settlement.registry';

/** Order ids of the documents that name one, once each. */
const orderIdsOf = (invoices: readonly InvoiceWithSources[]): number[] => [
	...new Set(
		invoices
			.map((invoice) => invoice.order_id)
			.filter((orderId): orderId is number => orderId !== null),
	),
];

/**
 * Spreads a client's money over their documents, then announces the orders that may have moved.
 *
 * The billing half of settlement: what a document is paid with. Whether an order is now confirmed
 * or completed is `order-settlement`'s call, reached through `notifyOrderStateChanged` - a
 * deployment without that feature still bills and allocates the same.
 */
export class InvoiceSettlementService {
	/**
	 * @description Used by the cash-flow-completed handler in `invoice.bootstrap.ts`
	 *
	 * For money coming in, spreads it over the client's open documents. The ledger entry is not
	 * written here - `cash-flow` books it in the transaction that completed the movement.
	 */
	public async onCashFlowCompleted(cashFlowId: number): Promise<void> {
		const cashFlow = await cashFlowService.findById(cashFlowId, false);

		if (cashFlow.direction !== CashFlowDirectionEnum.IN) {
			return;
		}

		const clientId = await cashFlowService.findClientId(cashFlow);

		if (!clientId) {
			return;
		}

		await this.settleClient(clientId);
	}

	/**
	 * @description Used after a document is issued - the settlement handlers and the invoice
	 * controller
	 *
	 * Money the client already holds with the business is spread over the new documents, and
	 * every order they belong to is announced: a reversal can settle its parent, and a document
	 * covered by an earlier overpayment is paid the moment it is issued.
	 */
	public async afterIssued(
		invoices: readonly InvoiceWithSources[],
	): Promise<void> {
		for (const clientId of new Set(
			invoices.map((invoice) => invoice.client_id),
		)) {
			await this.settleClient(clientId);
		}

		await notifyOrderStateChanged({ order_ids: orderIdsOf(invoices) });
	}

	/** The client's open money against their open documents, and the orders that moved. */
	public async settleClient(clientId: number): Promise<void> {
		const touched = await invoiceService.withSources(
			await invoicePaymentService.settleClient(clientId),
		);

		await notifyOrderStateChanged({ order_ids: orderIdsOf(touched) });
	}
}

export const invoiceSettlementService = new InvoiceSettlementService();
