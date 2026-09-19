import { Configuration } from '@/config/settings.config';
import type { invoiceController } from '@/features/invoice/invoice.controller';
import {
	InvoicePaymentStatusEnum,
	InvoiceStatusEnum,
	InvoiceTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/invoice/invoice.entity';
import {
	getInvoiceEntityMock,
	getInvoiceLineEntityMock,
	getInvoicePaymentEntityMock,
} from '@/features/invoice/invoice.mock';
import { OrderByEnum } from '@/features/invoice/invoice.validator';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
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
	'only a draft can be changed or deleted; an issued invoice leaves service through the canceled status';

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
		description: 'Create a draft invoice from an order',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Invoice created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `The lines are generated from the order: one per order line, plus one per shipping movement it carries that is not failed. ${documentNote}. The currency and exchange rate are the order's own - its line figures mean nothing in another one. A credit note is raised through POST /invoices/:id/credit-note instead`,
			body: {
				order_id: {
					type: 'number',
					required: true,
				},
				type: {
					type: 'enum',
					required: false,
					values: [InvoiceTypeEnum.CHARGE, InvoiceTypeEnum.PROFORMA],
					condition: `defaults to ${InvoiceTypeEnum.CHARGE}; each type draws its number from its own series`,
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
			notes: `${mutableNote}. The money on a document comes from its lines, so the totals are never accepted here`,
			params: {
				id: idParam,
			},
			body: {
				due_at: {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
				notes: {
					type: 'string',
					required: false,
				},
			},
		},
	}),

	delete: helperApiInputDocumentation({
		description: 'Delete a draft invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Invoice deleted successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: mutableNote,
			params: {
				id: idParam,
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
			notes: 'is_overdue reads "late right now" - stamped as overdue and still unsettled - rather than "was late at some point", which overdue_at alone says',
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
				'filter[order_id]': { type: 'number', required: false },
				'filter[parent_invoice_id]': {
					type: 'number',
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
				'filter[type]': {
					type: 'enum',
					required: false,
					values: Object.values(InvoiceTypeEnum),
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
				'filter[is_deleted]': { type: 'boolean', required: false },
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
			notes: `Allowed moves: ${statusTransitionNote}. ${documentNote}. Issuing needs at least one line, a billing address on the order and a country on it; canceling is refused once anything has been allocated against the document`,
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

	creditNote: helperApiInputDocumentation({
		description: 'Raise a credit note against an issued charge',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Credit note created successfully',
			dataSample: {
				...entitySample,
				type: InvoiceTypeEnum.CREDIT_NOTE,
				parent_invoice_id: 1,
			},
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: 'The note mirrors the parent lines and is raised as a draft of its own, so it is issued - and numbered from the credit note series - like any other document. Every figure stays positive; the type carries the sign',
			params: {
				id: idParam,
			},
			body: {
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
				quantity: { type: 'number', required: false },
				unit_price: { type: 'number', required: false },
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
			notes: `Only an issued invoice can be settled, and only by a completed cash flow entry in the same currency: the two amounts are separate columns with no rate between them. A charge is settled by an incoming movement and a credit note by an outgoing one. The amount is gross, in the invoice currency and its two decimals - not the net, scaled figure the movement stores - and cannot exceed what is left of that movement after its other allocations. The invoice payment status is recomputed in the same transaction`,
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

	paymentDelete: helperApiInputDocumentation({
		description: 'Remove a payment allocation from an invoice',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Payment allocation removed successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: 'A hard delete - the invoice/movement pair is unique over live rows, so a soft-deleted allocation would block ever allocating that movement to this invoice again. The payment status is recomputed from what remains',
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
