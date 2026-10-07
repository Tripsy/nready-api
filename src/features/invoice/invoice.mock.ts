import { ClientTypeEnum } from '@/features/client/client.entity';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import {
	InvoicePaymentStatusEnum,
	InvoiceScopeEnum,
	InvoiceStatusEnum,
	type InvoiceWithSources,
} from '@/features/invoice/invoice.entity';
import {
	InvoiceValidator,
	OrderByEnum,
} from '@/features/invoice/invoice.validator';
import type InvoiceLineEntity from '@/features/invoice/invoice-line.entity';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import type InvoicePaymentEntity from '@/features/invoice/invoice-payment.entity';
import {
	createFutureDate,
	createPastDate,
	formatDate,
} from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const invoiceValidator = new InvoiceValidator('invoice');

export function getInvoiceEntityMock(
	overrides?: Partial<InvoiceWithSources>,
): InvoiceWithSources {
	return {
		id: 1,
		client_id: 1,
		order_id: 1,
		subscription_id: null,
		shipping_id: null,
		ref_code: 'INV',
		ref_number: 142,
		status: InvoiceStatusEnum.ISSUED,
		payment_status: InvoicePaymentStatusEnum.PARTIAL,
		scope: InvoiceScopeEnum.ORDER,
		is_reversal: false,
		parent_invoice_id: null,
		currency: 'RON',
		exchange_rate: 1,
		total_net: 200,
		total_discount_reduction: 20,
		total_vat: 42,
		total_gross: 242,
		issued_at: createPastDate(86400),
		due_at: createFutureDate(86400 * 13),
		overdue_at: null,
		paid_at: null,
		billing_details: {
			type: ClientTypeEnum.COMPANY,
			company_name: 'Test Company SRL',
			company_cui: 'RO12345678',
			company_reg_com: 'J40/1234/2020',
			address_country: 'RO',
			address_region: 'Bucuresti',
			address_city: 'Bucuresti',
			details: 'Str. Exemplu 10',
			postal_code: '010101',
			contact_name: 'Test Contact',
			contact_email: 'contact@example.com',
			contact_phone: '+40700000000',
			iban: 'RO49AAAA1B31007593840000',
			bank_name: 'Test Bank',
		},
		seller_details: {
			company_name: 'Example SRL',
			company_cui: 'RO87654321',
			company_reg_com: 'J40/4321/2019',
			address_country: 'RO',
			address_region: 'Cluj',
			address_city: 'Cluj-Napoca',
			details: 'Str. Vanzator 1',
			postal_code: '400001',
			contact_name: 'Sales',
			contact_email: 'sales@example.com',
			contact_phone: '+40711111111',
			iban: 'RO49BBBB1B31007593840000',
			bank_name: 'Example Bank',
		},
		details: null,
		notes: 'Test invoice',
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		client: undefined as unknown as InvoiceEntity['client'],
		parent_invoice: null,
		...overrides,
	};
}

export function getInvoiceLineEntityMock(
	overrides?: Partial<InvoiceLineEntity>,
): InvoiceLineEntity {
	return {
		id: 1,
		invoice_id: 1,
		kind: InvoiceLineKindEnum.PRODUCT,
		order_line_id: 1,
		shipping_id: null,
		parent_line_id: null,
		is_value_reversal: false,
		product_id: 1,
		variant_id: 1,
		label: 'Test product, 500 ml',
		quantity: 2,
		unit_price: 110,
		vat_rate: 21,
		discount: null,
		discount_reduction: 20,
		line_net: 200,
		line_vat: 42,
		line_total: 242,
		notes: null,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		invoice: undefined as unknown as InvoiceLineEntity['invoice'],
		order_line: null,
		shipping: null,
		...overrides,
	};
}

export function getInvoicePaymentEntityMock(
	overrides?: Partial<InvoicePaymentEntity>,
): InvoicePaymentEntity {
	return {
		id: 1,
		invoice_id: 1,
		cash_flow_id: 1,
		amount: 100,
		notes: null,
		created_at: createPastDate(43200),
		updated_at: null,
		deleted_at: null,
		invoice: undefined as unknown as InvoicePaymentEntity['invoice'],
		cash_flow: undefined as unknown as InvoicePaymentEntity['cash_flow'],
		...overrides,
	};
}

export const invoiceInputPayloads = {
	create: {
		order_id: 1,
		scope: InvoiceScopeEnum.ORDER,
		shipping_id: undefined,
		subscription_id: undefined,
		due_at: formatDate(createFutureDate(86400 * 14)),
		notes: 'Test invoice',
	},
	update: {
		id: 1,
		due_at: formatDate(createFutureDate(86400 * 21)),
		notes: 'Updated invoice',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			id: 1,
			order_id: 1,
			status: InvoiceStatusEnum.ISSUED,
			payment_status: InvoicePaymentStatusEnum.PARTIAL,
			scope: InvoiceScopeEnum.ORDER,
			currency: 'RON',
			is_overdue: false,
		},
	},
	lineCreate: {
		id: 1,
		label: 'Rounding adjustment',
		quantity: 1,
		unit_price: 10,
		vat_rate: 21,
		discount_reduction: 0,
	},
	paymentCreate: {
		id: 1,
		cash_flow_id: 1,
		amount: 100,
	},
};

export const invoiceOutputPayloads = {
	create: invoiceValidator.create.parse(invoiceInputPayloads.create),
	update: invoiceValidator.update.parse(invoiceInputPayloads.update),
	find: invoiceValidator.find.parse(invoiceInputPayloads.find),
	lineCreate: invoiceValidator.lineCreate.parse(
		invoiceInputPayloads.lineCreate,
	),
	paymentCreate: invoiceValidator.paymentCreate.parse(
		invoiceInputPayloads.paymentCreate,
	),
};
