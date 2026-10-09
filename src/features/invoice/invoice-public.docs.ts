import {
	CashFlowDirectionEnum,
	CashFlowMethodEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import {
	InvoicePaymentStatusEnum,
	InvoiceScopeEnum,
	InvoiceStatusEnum,
} from '@/features/invoice/invoice.entity';
import type { invoicePublicController } from '@/features/invoice/invoice-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/** One document as the buyer is shown it - see `InvoiceService.findPublicForOrder`. */
const invoiceSample: Record<string, unknown> = {
	id: 204,
	ref_code: 'INV',
	ref_number: 1183,
	status: InvoiceStatusEnum.ISSUED,
	payment_status: InvoicePaymentStatusEnum.PAID,
	scope: InvoiceScopeEnum.ORDER,
	is_reversal: false,
	parent_invoice_id: null,
	currency: 'RON',
	total_net: 470,
	total_vat: 98.7,
	total_gross: 568.7,
	issued_at: '2026-08-14T11:40:00.000Z',
	due_at: '2026-08-28T00:00:00.000Z',
	paid_at: '2026-08-14T11:41:00.000Z',
};

/** One payment as the buyer is shown it - see `CashFlowService.findPublicForOrder`. */
const paymentSample: Record<string, unknown> = {
	id: 77,
	direction: CashFlowDirectionEnum.IN,
	method: CashFlowMethodEnum.BANK_TRANSFER,
	status: CashFlowStatusEnum.COMPLETED,
	gross_amount: 568.7,
	currency: 'RON',
	created_at: '2026-08-14T11:32:00.000Z',
	updated_at: '2026-08-14T11:41:00.000Z',
};

/**
 * The storefront half: the billing side of the caller's own orders. Documented as its own module
 * because docs are registered under the route file's own name.
 */
export const docs: Record<
	keyof typeof invoicePublicController,
	ApiInputDocumentation
> = {
	billing: helperApiInputDocumentation({
		description:
			"The invoices and payments of one of the caller's own orders",
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Documents raised for the order and money filed under it, oldest first',
			dataSample: {
				invoices: [invoiceSample],
				payments: [paymentSample],
			},
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Requires an account. An order billed to somebody else's client answers 404, the same as a missing one. Unpaginated. `invoices` holds the issued documents billing the order's goods (`scope` `order`) or one of its delivery fees (`scope` `shipping`), and their reversals - `is_reversal` with `parent_invoice_id` naming the original; figures stay positive and the flag carries the sign. Drafts and canceled documents are not listed. `payments` holds every movement filed under the order, any status; a refund is `direction` `out`, and `gross_amount` is unsigned",
			params: {
				order_id: { type: 'number', required: true },
			},
		},
	}),
};
