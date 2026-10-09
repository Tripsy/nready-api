import { Configuration } from '@/config/settings.config';
import type { invoiceController } from '@/features/invoice/invoice.controller';
import {
	InvoicePaymentStatusEnum,
	InvoiceScopeEnum,
	InvoiceStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/invoice/invoice.entity';
import {
	getInvoiceEntityMock,
	getInvoiceLineEntityMock,
	getInvoicePaymentEntityMock,
} from '@/features/invoice/invoice.mock';
import { OrderByEnum } from '@/features/invoice/invoice.validator';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import { documentSample } from '@/features/invoice/invoice-public.docs';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getInvoiceEntityMock() as unknown as Record<
	string,
	unknown
>;

const lineSample = getInvoiceLineEntityMock() as unknown as Record<
	string,
	unknown
>;

const paymentSample = getInvoicePaymentEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Rendered as `draft -> issued | canceled`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ') || 'none'}`)
	.join('; ');

const documentNote = `a document is raised as a draft and holds no number; the number is allocated from document_series when it moves to ${InvoiceStatusEnum.ISSUED}, which also freezes the billing and seller details onto the row`;

const mutableNote =
	'only a draft can be changed or canceled; an issued invoice is taken back by a reversal';

const idParam = {
	type: 'number' as const,
	required: true,
	condition: 'the invoice id',
};

export const docs: Record<
	keyof typeof invoiceController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a draft order, shipping or subscription invoice',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Invoice created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `What the document itemizes follows from its scope. ${InvoiceScopeEnum.ORDER}: the order's goods not billed yet by another live document, or exactly the parts named in lines - an order may carry several. ${InvoiceScopeEnum.SHIPPING}: the one movement of goods named by shipping_id, refused when a live document already bills it. ${InvoiceScopeEnum.SUBSCRIPTION}: no lines yet; the period is itemized through POST /invoices/:id/lines. ${documentNote}. The client, currency and exchange rate are the order's own. A reversal is raised through POST /invoices/:id/reverse instead`,
			body: {
				order_id: {
					type: 'number',
					required: true,
				},
				scope: {
					type: 'enum',
					required: false,
					values: [
						InvoiceScopeEnum.ORDER,
						InvoiceScopeEnum.SHIPPING,
						InvoiceScopeEnum.SUBSCRIPTION,
					],
					condition: `defaults to ${InvoiceScopeEnum.ORDER}; the three share the invoice series`,
				},
				shipping_id: {
					type: 'number',
					required: false,
					condition: `required when scope is ${InvoiceScopeEnum.SHIPPING}; a shipping of this order`,
				},
				subscription_id: {
					type: 'number',
					required: false,
					condition: `required when scope is ${InvoiceScopeEnum.SUBSCRIPTION}`,
				},
				lines: {
					type: 'array',
					required: false,
					condition: `${InvoiceScopeEnum.ORDER} only; [{ order_line_id, quantity }], each quantity at most what is left to bill on that line. Omitted, every line's remainder is billed`,
				},
				due_at: {
					type: 'string',
					required: false,
					condition: `ISO 8601; defaults to ${Configuration.get('invoice.dueDays')} days after the invoice is issued, and is replaced by that term if it has already passed when the invoice is issued`,
				},
				notes: {
					type: 'string',
					required: false,
				},
			},
		},
	}),

	createCustom: helperApiInputDocumentation({
		description: 'Create an empty custom invoice draft',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Invoice created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: `A document built by hand for a client, with no order behind it: scope ${InvoiceScopeEnum.CUSTOM}, in the base currency. It starts with no lines - write them, the parties and the rest through PUT /invoices/:id, the same as on any draft; issuing refuses it until it has a line. The buyer is frozen from the client's billing address when there is one; otherwise it is stated through PUT /invoices/:id before issuing. ${documentNote}`,
			body: {
				client_id: {
					type: 'number',
					required: true,
				},
				due_at: {
					type: 'string',
					required: false,
					condition: `ISO 8601; defaults to ${Configuration.get('invoice.dueDays')} days after the invoice is issued`,
				},
				notes: {
					type: 'string',
					required: false,
				},
			},
		},
	}),

	read: helperApiInputDocumentation({
		description: 'Read an invoice with its lines and payment allocations',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice details',
			dataSample: {
				...entitySample,
				lines: [lineSample],
				payments: [paymentSample],
				amount_outstanding: 142, // total_gross 242 less the 100 allocated
			},
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			params: {
				id: idParam,
			},
		},
	}),

	document: helperApiInputDocumentation({
		description: 'Read an invoice as it prints',
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'The document with its frozen parties, its lines, the order it bills and, on a shipping document, the movement',
			dataSample: documentSample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: 'The same shape the buyer prints through `GET /public/orders/:order_id/invoices/:id` - see that action. Any status is answered; only an issued document is meant to print',
			params: {
				id: idParam,
			},
		},
	}),

	update: helperApiInputDocumentation({
		description: 'Update a draft invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `${mutableNote}. The money on a document comes from its lines, so the totals are never accepted here - they are re-summed from \`lines\` when it is sent`,
			params: {
				id: idParam,
			},
			body: {
				due_at: {
					type: 'string',
					required: false,
					condition: `ISO 8601; replaced by the standard ${Configuration.get('invoice.dueDays')}-day term if it has already passed when the invoice is issued`,
				},
				notes: {
					type: 'string',
					required: false,
				},
				billing_details: {
					type: 'object',
					required: false,
					condition:
						'The buyer stated by hand: { type: person, person_name, person_identification_number? } or { type: company, company_name, company_cui?, company_reg_com? }, plus address_country (required), address_region?, address_city?, details?, postal_code?, contact_name?, contact_email?, contact_phone?, iban?, bank_name?. Issuing freezes it as given instead of resolving the buyer from the order. null clears it, so issuing resolves the buyer again. The detail read of a draft reports resolved_billing_details - what issuing would use otherwise. Refused on a reversal',
				},
				seller_details: {
					type: 'object',
					required: false,
					condition:
						'The issuer stated by hand: { company_name, company_cui?, company_reg_com? } plus the same address, contact and bank fields as billing_details. Issuing freezes it as given instead of the configured company. null clears it. The detail read of a draft reports resolved_seller_details. Refused on a reversal',
				},
				lines: {
					type: 'array',
					required: false,
					condition:
						'[{ id?, label, quantity, unit_price, vat_rate, discount_reduction?, notes? }] - the whole set the draft should itemize, applied in one transaction with the header. With id: restates that line of this invoice (product and shipping lines within max_quantity / max_unit_price from the detail read). Without id: adds an adjustment line. A line left out is removed; an empty array removes them all. On a reversal no line may be added and only label and notes may change',
				},
			},
		},
	}),

	find: helperApiInputDocumentation({
		description: 'List invoices',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice list',
			dataSample: {
				entries: [entitySample],
				pagination: { page: 1, limit: 20, total: 1 },
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'is_overdue reads "late right now" - stamped as overdue and still unsettled - rather than "was late at some point", which overdue_at alone says. Each entry carries reversible_net: on an issued original, its net less what every non-canceled reversal (draft included) already took back - 0 once nothing is left to reverse; null on drafts, canceled documents and reversals. Each entry also carries amount_outstanding: on an issued document, what it still asks for - total_gross less its allocations and, on an original, less its issued reversals, floored at 0; null on drafts and canceled documents',
			query: {
				page: { type: 'number', required: false },
				limit: { type: 'number', required: false },
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
				},
				'filter[client_id]': { type: 'number', required: false },
				'filter[order_id]': { type: 'number', required: false },
				'filter[subscription_id]': { type: 'number', required: false },
				'filter[shipping_id]': {
					type: 'number',
					required: false,
					condition: 'the movement a shipping invoice bills',
				},
				'filter[parent_invoice_id]': {
					type: 'number',
					required: false,
				},
				'filter[is_reversal]': {
					type: 'boolean',
					required: false,
				},
				'filter[status]': {
					type: 'enum',
					required: false,
					values: Object.values(InvoiceStatusEnum),
				},
				'filter[payment_status]': {
					type: 'enum',
					required: false,
					values: Object.values(InvoicePaymentStatusEnum),
				},
				'filter[scope]': {
					type: 'enum',
					required: false,
					values: Object.values(InvoiceScopeEnum),
				},
				'filter[currency]': {
					type: 'string',
					required: false,
					condition: '3-letter ISO 4217 code',
				},
				'filter[is_overdue]': { type: 'boolean', required: false },
				'filter[issued_at_start]': { type: 'string', required: false },
				'filter[issued_at_end]': { type: 'string', required: false },
				'filter[term]': {
					type: 'string',
					required: false,
					condition:
						'a number matches the printed ref_number or the id; text matches the series code or the notes',
				},
			},
		},
	}),

	statusUpdate: helperApiInputDocumentation({
		description: 'Issue or cancel an invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice status updated successfully',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Allowed moves: ${statusTransitionNote}. ${documentNote}. Issuing needs at least one line, a billing address on the order and a country on it. Only a draft can be canceled: an issued invoice is taken back by a reversal (POST /invoices/:id/reverse), never canceled. Issuing a reversal writes its ledger entry and, when the client is left overpaid on the original, pays the difference back in the same transaction: completed refund cash flows against the original's payments, booked to the ledger and allocated to the reversal. An unpaid original is owed nothing back`,
			params: {
				id: idParam,
				status: {
					type: 'enum',
					required: true,
					values: Object.values(InvoiceStatusEnum),
				},
			},
		},
	}),

	raiseForCashFlow: helperApiInputDocumentation({
		description: 'Raise and issue the invoice a revenue movement is owed',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Invoice raised and issued successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: "The movement's order record decides what the document itemizes: with an order named, the order's goods not billed yet; with none, a custom invoice - a single line worth what the movement was worth, billed to the client's billing address. The client's captured money is then allocated against their open documents, oldest due first - so the movement settles this document only if nothing older is still open. Refused with 409 when the order is already billed in full, or when a movement with no order has already been allocated",
			params: {
				cash_flow_id: {
					type: 'number' as const,
					required: true,
					condition: 'the cash flow id',
				},
			},
		},
	}),

	reverse: helperApiInputDocumentation({
		description: 'Raise a reversal (storno) against an issued invoice',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Reversal created successfully',
			dataSample: {
				...entitySample,
				is_reversal: true,
				parent_invoice_id: 1,
			},
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: 'The reversal keeps the type of the invoice it reverses and is raised as a draft, then issued and numbered from the invoice series like any other document. Its lines mirror the original figures; every figure stays positive and is_reversal carries the sign. A reversal cannot itself be reversed. Its line figures cannot be edited, only its labels and notes',
			params: {
				id: idParam,
			},
			body: {
				lines: {
					type: 'array',
					required: false,
					condition:
						'[{ invoice_line_id, quantity } | { invoice_line_id, amount }] - lines of this invoice, each with exactly one of the two. quantity: goods returned, at most what earlier quantity reversals left, carrying its share of the line discount, and billable again on the order. amount: a net price correction on goods the client keeps, written as one unit at the line VAT rate, releasing nothing for billing. Across every reversal of a line, the net taken back never exceeds the line net. Omitted, the remaining units of every line are taken back by quantity; a line already corrected by value so far that its remaining units no longer fit in its remaining net is left out. The detail read reports reversed_quantity and reversed_net per line',
				},
				notes: {
					type: 'string',
					required: false,
				},
			},
		},
	}),

	lineCreate: helperApiInputDocumentation({
		description: 'Add an adjustment line to a draft invoice',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Invoice line added successfully',
			dataSample: {
				...lineSample,
				kind: InvoiceLineKindEnum.ADJUSTMENT,
				order_line_id: null,
				product_id: null,
				variant_id: null,
			},
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `${mutableNote}. Only an ${InvoiceLineKindEnum.ADJUSTMENT} line can be added by hand - a ${InvoiceLineKindEnum.PRODUCT} or ${InvoiceLineKindEnum.SHIPPING} line names the row it was raised from and is generated from the order. The line net, VAT and total are computed here and the invoice totals re-summed`,
			params: {
				id: idParam,
			},
			body: {
				label: { type: 'string', required: true },
				quantity: {
					type: 'number',
					required: true,
					condition: 'positive, max 2 decimals',
				},
				unit_price: {
					type: 'number',
					required: true,
					condition: 'excluding VAT, in the invoice currency',
				},
				vat_rate: {
					type: 'number',
					required: true,
					condition: 'percent, max 2 decimals',
				},
				discount_reduction: {
					type: 'number',
					required: false,
					condition:
						'money off the whole line, excluding VAT; cannot exceed the line value',
				},
				notes: { type: 'string', required: false },
			},
		},
	}),

	lineUpdate: helperApiInputDocumentation({
		description: 'Update a line of a draft invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice line updated successfully',
			dataSample: lineSample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `${mutableNote}. The stored line figures are recomputed from whatever the line reads after the patch, and the invoice totals with them`,
			params: {
				id: idParam,
				line_id: {
					type: 'number',
					required: true,
					condition: 'a line of this invoice',
				},
			},
			body: {
				label: { type: 'string', required: false },
				quantity: {
					type: 'number',
					required: false,
					condition:
						'on a product or shipping line, at most max_quantity from the detail read - what its source has left to invoice, this line included',
				},
				unit_price: {
					type: 'number',
					required: false,
					condition:
						'on a product or shipping line, at most max_unit_price from the detail read - the unit price of its source',
				},
				vat_rate: { type: 'number', required: false },
				discount_reduction: { type: 'number', required: false },
				notes: { type: 'string', required: false },
			},
		},
	}),

	lineDelete: helperApiInputDocumentation({
		description: 'Remove a line from a draft invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice line removed successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `${mutableNote}. The invoice totals are re-summed from the lines that remain`,
			params: {
				id: idParam,
				line_id: {
					type: 'number',
					required: true,
					condition: 'a line of this invoice',
				},
			},
		},
	}),

	paymentCreate: helperApiInputDocumentation({
		description: 'Allocate a cash flow entry against an invoice',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Payment allocated successfully',
			dataSample: paymentSample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Only an issued invoice can be settled, and only by a completed cash flow entry in the same currency: the two amounts are separate columns with no rate between them. An invoice is settled by an incoming movement and a reversal by an outgoing one. The movement must be filed under the invoice's own client - money is never moved between clients. The amount is gross, in the invoice currency and its two decimals - not the net, scaled figure the movement stores - and cannot exceed what is left of that movement after its other allocations, nor what the invoice still asks for. The invoice payment status is recomputed in the same transaction`,
			params: {
				id: idParam,
			},
			body: {
				cash_flow_id: { type: 'number', required: true },
				amount: {
					type: 'number',
					required: true,
					condition: 'gross, positive, max 2 decimals',
				},
				notes: { type: 'string', required: false },
			},
		},
	}),

	paymentClear: helperApiInputDocumentation({
		description: 'Remove every payment allocation from an invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Payment allocations removed successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: 'Hands the money back to the movements it came from, for an operator to allocate to another invoice of the same client. Refused on a reversal (its allocations are refunds already paid out), on an invoice with an issued reversal (its payments may have been refunded), and on an invoice with no allocations. Nothing is re-spread automatically - the next capture or issue for the client spreads whatever is still unallocated, oldest due first. The order is not moved back',
			params: {
				id: idParam,
			},
		},
	}),

	paymentDelete: helperApiInputDocumentation({
		description: 'Remove a payment allocation from an invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Payment allocation removed successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: 'Refused on a reversal and on an invoice with an issued reversal, as for clearing. A hard delete - the invoice/movement pair is unique over live rows, so a soft-deleted allocation would block ever allocating that movement to this invoice again. The payment status is recomputed from what remains',
			params: {
				id: idParam,
				payment_id: {
					type: 'number',
					required: true,
					condition: 'an allocation of this invoice',
				},
			},
		},
	}),
};
