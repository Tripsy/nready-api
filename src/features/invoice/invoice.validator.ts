import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	InvoicePaymentStatusEnum,
	InvoiceStatusEnum,
	InvoiceTypeEnum,
} from '@/features/invoice/invoice.entity';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * What an invoice accepts on `update`. Deliberately short: the money on a document comes from its
 * lines and is rewritten by the line endpoints, not by patching a total, and `currency` is not
 * updatable at all - every stored figure is quoted in it, so changing it would restate the
 * document without touching a single line.
 */
export const paramsUpdateList: string[] = ['due_at', 'notes'];

/** What a line accepts on `update` - the same arithmetic inputs `lineCreate` takes. */
export const lineParamsUpdateList: string[] = [
	'label',
	'quantity',
	'unit_price',
	'vat_rate',
	'discount_reduction',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	REF_NUMBER: 'ref_number',
	STATUS: 'status',
	TOTAL_GROSS: 'total_gross',
	ISSUED_AT: 'issued_at',
	DUE_AT: 'due_at',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_order_id',
	'invalid_type',
	'invalid_status',
	'invalid_payment_status',
	'invalid_kind',
	'invalid_currency',
	'invalid_quantity',
	'invalid_unit_price',
	'invalid_vat_rate',
	'invalid_discount_reduction',
	'invalid_label',
	'invalid_amount',
	'invalid_cash_flow_id',
	'invalid_line_id',
	'invalid_payment_id',
] as const;

export class InvoiceValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * A money or percentage figure that may legitimately be zero - a zero-rated line, a line with
	 * no discount on it. `validateNumber`'s `onlyPositive` is strictly greater than zero, which
	 * would refuse both, so the floor is applied here instead.
	 *
	 * Two methods rather than one taking a flag: `validateNumber` discriminates its return type on
	 * a literal `required`, so a boolean parameter matches neither overload.
	 */
	private nonNegativeSchema(message: string) {
		return this.validateNumber(message, {
			onlyPositive: false,
			allowDecimals: 2,
		}).refine((value) => value >= 0, { message: message });
	}

	private nonNegativeOptionalSchema(message: string) {
		return this.validateNumber(message, {
			required: false,
			onlyPositive: false,
			allowDecimals: 2,
		}).refine((value) => value === undefined || value >= 0, {
			message: message,
		});
	}

	private dueAtSchema() {
		return this.validateDate(
			{
				invalid_date: this.getMessage('invalid_date'),
				invalid_date_format: this.getMessage('invalid_date_format'),
				invalid_past_date: this.getMessage('invalid_past_date'),
				invalid_future_date: this.getMessage('invalid_future_date'),
			},
			{ required: false },
		);
	}

	/**
	 * The figures a manual line is written from. The invoice's own totals are never accepted -
	 * they are summed from the lines, so a caller could otherwise hand over a document whose
	 * header disagrees with what it itemizes.
	 */
	private readonly lineFields = {
		label: this.validateString(this.getMessage('invalid_label'), {
			required: true,
			maxChars: 255,
		}),
		quantity: this.validateNumber(this.getMessage('invalid_quantity'), {
			required: true,
			onlyPositive: true,
			allowDecimals: 2,
		}),
		unit_price: this.validateNumber(this.getMessage('invalid_unit_price'), {
			required: true,
			onlyPositive: true,
			allowDecimals: 2,
		}),
		vat_rate: this.nonNegativeSchema(this.getMessage('invalid_vat_rate')),
		discount_reduction: this.nonNegativeOptionalSchema(
			this.getMessage('invalid_discount_reduction'),
		),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	};

	readonly create = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
		type: this.validateEnum(
			InvoiceTypeEnum,
			this.getMessage('invalid_type'),
			{ required: false },
		),
		due_at: this.dueAtSchema(),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			due_at: this.dueAtSchema(),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			order_id: this.validateId(this.getMessage('invalid_order_id'), {
				required: false,
			}),
			parent_invoice_id: this.validateId(
				this.getMessage('invalid_number'),
				{ required: false },
			),
			status: this.validateEnum(
				InvoiceStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			payment_status: this.validateEnum(
				InvoicePaymentStatusEnum,
				this.getMessage('invalid_payment_status'),
				{ required: false },
			),
			type: this.validateEnum(
				InvoiceTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			currency: this.validateString(this.getMessage('invalid_currency'), {
				required: false,
				minChars: CURRENCY_CODE_CHARS,
				maxChars: CURRENCY_CODE_CHARS,
			}),
			// Late right now, which is both `overdue_at` and an unsettled payment status
			is_overdue: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			),
			issued_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			issued_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
			}),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			InvoiceStatusEnum,
			this.getMessage('invalid_status'),
		),
	});

	/**
	 * The movement to raise a charge for. `cash_flow_id` rather than `id`, because the route's
	 * `:id` names a row in another feature's table and reading it as an invoice id is exactly the
	 * mix-up that would otherwise go unnoticed.
	 */
	readonly raiseForCashFlow = z.object({
		cash_flow_id: this.validateId(this.getMessage('invalid_cash_flow_id')),
	});

	readonly creditNote = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	});

	readonly lineCreate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		/*
		 * Only `adjustment` is offered: a `product` or `shipping` line names the row it was
		 * raised from, and that is resolved from the order when the invoice is generated - a
		 * caller naming one by hand could point a line at a row on somebody else's order.
		 */
		kind: this.validateEnum(
			{ ADJUSTMENT: InvoiceLineKindEnum.ADJUSTMENT },
			this.getMessage('invalid_kind'),
			{ required: false },
		),
		...this.lineFields,
	});

	readonly lineUpdate = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			line_id: this.validateId(this.getMessage('invalid_line_id')),
			label: this.validateString(this.getMessage('invalid_label'), {
				required: false,
				maxChars: 255,
			}),
			quantity: this.validateNumber(this.getMessage('invalid_quantity'), {
				required: false,
				onlyPositive: true,
				allowDecimals: 2,
			}),
			unit_price: this.validateNumber(
				this.getMessage('invalid_unit_price'),
				{ required: false, onlyPositive: true, allowDecimals: 2 },
			),
			vat_rate: this.nonNegativeOptionalSchema(
				this.getMessage('invalid_vat_rate'),
			),
			discount_reduction: this.nonNegativeOptionalSchema(
				this.getMessage('invalid_discount_reduction'),
			),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
		})
		.refine((data) => hasAtLeastOneValue(data, lineParamsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: lineParamsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly lineDelete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		line_id: this.validateId(this.getMessage('invalid_line_id')),
	});

	readonly paymentCreate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		cash_flow_id: this.validateId(this.getMessage('invalid_cash_flow_id')),
		/*
		 * Gross, in the invoice's currency and its two decimals - the unit
		 * `invoice_payment.amount` stores, which is not the scaled net figure the movement
		 * itself carries.
		 */
		amount: this.validateNumber(this.getMessage('invalid_amount'), {
			required: true,
			onlyPositive: true,
			allowDecimals: 2,
		}),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	});

	readonly paymentDelete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		payment_id: this.validateId(this.getMessage('invalid_payment_id')),
	});
}
