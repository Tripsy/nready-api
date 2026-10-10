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
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
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

const partySample: Record<string, unknown> = {
	address_country: 'RO',
	address_region: 'Cluj',
	address_city: 'Cluj-Napoca',
	details: 'Str. Memorandumului 28',
	postal_code: '400114',
	contact_name: null,
	contact_email: 'billing@example.com',
	contact_phone: null,
	iban: null,
	bank_name: null,
};

/** One document as it prints - see `InvoiceService.buildDocument`. Shared with the back office's. */
export const documentSample: Record<string, unknown> = {
	...invoiceSample,
	total_discount_reduction: 30,
	billing_details: {
		...partySample,
		type: 'person',
		person_name: 'Ana Pop',
	},
	seller_details: {
		...partySample,
		company_name: 'NReady SRL',
		company_cui: 'RO12345678',
		company_reg_com: 'J12/1234/2020',
		company_vat_number: 'RO12345678',
		iban: 'RO49AAAA1B31007593840000',
		bank_name: 'Example Bank',
	},
	parent_invoice: null,
	order: {
		id: 33,
		ref_code: 'ORD',
		ref_number: 33,
		created_at: '2026-08-14T11:30:00.000Z',
	},
	shipping: null,
	lines: [
		{
			id: 911,
			kind: InvoiceLineKindEnum.PRODUCT,
			is_value_reversal: false,
			label: 'Desk lamp - Black',
			quantity: 2,
			unit_price: 250,
			vat_rate: 21,
			discount_reduction: 30,
			line_net: 470,
			line_vat: 98.7,
			line_total: 568.7,
		},
	],
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
	document: helperApiInputDocumentation({
		description: "One issued document of the caller's own order, to print",
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'The document with its frozen parties and its lines, figures as stored',
			dataSample: documentSample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Requires an account. Answers 404 for an order billed to somebody else's client, and for a document not listed by `billing` for the order - a draft, a canceled one, or one of another order. Figures stay positive on a reversal; `is_reversal` carries the sign and `parent_invoice` names the document it takes back. `order` is the order billed. `shipping` is set on a `shipping` document only: carrier, both ends (`pickup_data` / `destination_data` once shipped, else the warehouse or client-address label) and its dates, read live. `seller_details.company_vat_number` null states the seller is not VAT-registered; absent on documents issued before it was recorded. Notes are not included",
			params: {
				order_id: { type: 'number', required: true },
				id: { type: 'number', required: true },
			},
		},
	}),
};
