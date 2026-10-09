import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { ClientTypeEnum } from '@/features/client/client.entity';
import {
	InvoicePaymentStatusEnum,
	InvoiceScopeEnum,
	InvoiceStatusEnum,
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
 *
 * `billing_details` and `seller_details` are the two parties as the operator states them by hand;
 * issuing freezes them as given instead of resolving them, and `null` hands them back to it.
 */
export const paramsUpdateList: string[] = [
	'due_at',
	'notes',
	'billing_details',
	'seller_details',
];

/**
 * `update` also takes `lines`, the whole set the draft should itemize - kept apart from
 * `paramsUpdateList` because that list is copied onto the invoice row as-is.
 */
const updateAcceptsList: string[] = [...paramsUpdateList, 'lines'];

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
	'invalid_client_id',
	'invalid_shipping_id',
	'invalid_subscription_id',
	'invalid_order_line_id',
	'invalid_invoice_line_id',
	'invalid_reversal_line',
	'invalid_lines',
	'scope_requires_shipping',
	'scope_requires_subscription',
	'lines_only_for_order',
	'invalid_scope',
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
	'invalid_billing_details',
	'invalid_seller_details',
	'invalid_party_name',
	'invalid_party_identifier',
	'invalid_address_country',
	'invalid_address',
	'invalid_contact_name',
	'invalid_contact_email',
	'invalid_contact_phone',
	'invalid_iban',
	'invalid_bank_name',
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
	 * A text field of a frozen party. Blank reads as `null`, so the snapshot is written whole - every
	 * key present, the way `AddressSnapshotBase` requires.
	 */
	private partyText(message: string, maxChars = 255) {
		return this.validateString(message, {
			required: false,
			maxChars: maxChars,
		}).transform((value) => value ?? null);
	}

	/** What the buyer and the seller share: the address, the contact and the bank. */
	private partyFields() {
		return {
			address_country: this.validateString(
				this.getMessage('invalid_address_country'),
				{ maxChars: 100 },
			),
			address_region: this.partyText(this.getMessage('invalid_address')),
			address_city: this.partyText(this.getMessage('invalid_address')),
			details: this.partyText(this.getMessage('invalid_address')),
			postal_code: this.partyText(this.getMessage('invalid_address'), 20),
			contact_name: this.partyText(
				this.getMessage('invalid_contact_name'),
			),
			contact_email: this.validateEmail(
				this.getMessage('invalid_contact_email'),
				{ required: false },
			).transform((value) => value ?? null),
			contact_phone: this.validatePhone(
				this.getMessage('invalid_contact_phone'),
				{ required: false },
			).transform((value) => value ?? null),
			iban: this.validateIBAN(this.getMessage('invalid_iban'), {
				required: false,
			}).transform((value) => value ?? null),
			bank_name: this.partyText(this.getMessage('invalid_bank_name')),
		};
	}

	/**
	 * The buyer, stated by hand: a person or a company, told apart by `type` the way
	 * `BillingDetails` is.
	 */
	private billingDetailsSchema() {
		return z
			.discriminatedUnion(
				'type',
				[
					z.object({
						type: z.literal(ClientTypeEnum.PERSON),
						person_name: this.validateString(
							this.getMessage('invalid_party_name'),
							{ maxChars: 255 },
						),
						person_identification_number: this.partyText(
							this.getMessage('invalid_party_identifier'),
							50,
						),
						...this.partyFields(),
					}),
					z.object({
						type: z.literal(ClientTypeEnum.COMPANY),
						company_name: this.validateString(
							this.getMessage('invalid_party_name'),
							{ maxChars: 255 },
						),
						company_cui: this.partyText(
							this.getMessage('invalid_party_identifier'),
							50,
						),
						company_reg_com: this.partyText(
							this.getMessage('invalid_party_identifier'),
							50,
						),
						...this.partyFields(),
					}),
				],
				{ message: this.getMessage('invalid_billing_details') },
			)
			.nullable()
			.optional();
	}

	/** The issuer, stated by hand - always a company, as `SellerDetails` is. */
	private sellerDetailsSchema() {
		return z
			.object(
				{
					company_name: this.validateString(
						this.getMessage('invalid_party_name'),
						{ maxChars: 255 },
					),
					company_cui: this.partyText(
						this.getMessage('invalid_party_identifier'),
						50,
					),
					company_reg_com: this.partyText(
						this.getMessage('invalid_party_identifier'),
						50,
					),
					company_vat_number: this.partyText(
						this.getMessage('invalid_party_identifier'),
						50,
					),
					...this.partyFields(),
				},
				{ message: this.getMessage('invalid_seller_details') },
			)
			.nullable()
			.optional();
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

	/**
	 * A reversal is not raised here - it is raised against its original through `reverse`.
	 * Each scope names what it bills on top of the order: a `shipping` document the
	 * movement, a `subscription` document the subscription. `lines` picks part of an order's goods
	 * to bill - partial shipments, goods and services apart - and is refused on any other scope.
	 */
	readonly create = z
		.object({
			order_id: this.validateId(this.getMessage('invalid_order_id')),
			// `custom` names no order and is raised through `createCustom`
			scope: this.validateEnum(
				{
					ORDER: InvoiceScopeEnum.ORDER,
					SHIPPING: InvoiceScopeEnum.SHIPPING,
					SUBSCRIPTION: InvoiceScopeEnum.SUBSCRIPTION,
				},
				this.getMessage('invalid_scope'),
				{ required: false },
			),
			shipping_id: this.validateId(
				this.getMessage('invalid_shipping_id'),
				{
					required: false,
				},
			),
			subscription_id: this.validateId(
				this.getMessage('invalid_subscription_id'),
				{ required: false },
			),
			lines: z
				.array(
					z.object({
						order_line_id: this.validateId(
							this.getMessage('invalid_order_line_id'),
						),
						quantity: this.validateNumber(
							this.getMessage('invalid_quantity'),
							{
								required: true,
								onlyPositive: true,
								allowDecimals: 2,
							},
						),
					}),
				)
				.min(1, { message: this.getMessage('invalid_lines') })
				.optional(),
			due_at: this.dueAtSchema(),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
		})
		.refine(
			(data) =>
				data.scope !== InvoiceScopeEnum.SHIPPING || !!data.shipping_id,
			{
				message: this.getMessage('scope_requires_shipping'),
				path: ['shipping_id'],
			},
		)
		.refine(
			(data) =>
				data.scope !== InvoiceScopeEnum.SUBSCRIPTION ||
				!!data.subscription_id,
			{
				message: this.getMessage('scope_requires_subscription'),
				path: ['subscription_id'],
			},
		)
		.refine(
			(data) =>
				!data.lines ||
				(data.scope ?? InvoiceScopeEnum.ORDER) ===
					InvoiceScopeEnum.ORDER,
			{
				message: this.getMessage('lines_only_for_order'),
				path: ['lines'],
			},
		);

	/**
	 * A custom document: who it is for. It starts empty - the lines, the parties and the rest are
	 * written through `update`, the same as on any draft. No currency: it is raised in the base
	 * currency, with nothing to take another one from.
	 */
	readonly createCustom = z.object({
		client_id: this.validateId(this.getMessage('invalid_client_id')),
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
			billing_details: this.billingDetailsSchema(),
			seller_details: this.sellerDetailsSchema(),
			/*
			 * The full set of lines the draft should read after the save: an entry with `id`
			 * restates that line, one without adds an `adjustment`, and a line left out is
			 * removed. Empty is allowed - a draft may itemize nothing until it is issued.
			 */
			lines: z
				.array(
					z.object({
						id: this.validateId(
							this.getMessage('invalid_line_id'),
							{
								required: false,
							},
						),
						...this.lineFields,
					}),
					{ message: this.getMessage('invalid_lines') },
				)
				.refine(
					(lines) => {
						const ids = lines
							.map((line) => line.id)
							.filter((id) => id != null);

						return new Set(ids).size === ids.length;
					},
					{ message: this.getMessage('invalid_lines') },
				)
				.optional(),
		})
		// `lines: []` counts: it is how a draft drops every line, and an empty array reads as
		// no value to `hasAtLeastOneValue`
		.refine(
			(data) =>
				data.lines !== undefined ||
				// `null` on a party is a value here: it hands the party back to issuing
				data.billing_details !== undefined ||
				data.seller_details !== undefined ||
				hasAtLeastOneValue(data, paramsUpdateList),
			{
				message: this.getMessage('params_at_least_one', {
					params: updateAcceptsList.join(', '),
				}),
				path: ['_global'],
			},
		);

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
			client_id: this.validateId(this.getMessage('invalid_client_id'), {
				required: false,
			}),
			order_id: this.validateId(this.getMessage('invalid_order_id'), {
				required: false,
			}),
			subscription_id: this.validateId(
				this.getMessage('invalid_subscription_id'),
				{ required: false },
			),
			shipping_id: this.validateId(
				this.getMessage('invalid_shipping_id'),
				{
					required: false,
				},
			),
			parent_invoice_id: this.validateId(
				this.getMessage('invalid_number'),
				{ required: false },
			),
			is_reversal: this.validateBoolean(
				this.getMessage('invalid_boolean'),
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
			scope: this.validateEnum(
				InvoiceScopeEnum,
				this.getMessage('invalid_scope'),
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

	/**
	 * A storno against an issued document. `lines` takes back part of it, each named line either
	 * by `quantity` (goods returned) or by `amount` (net price correction) - exactly one of the
	 * two; omitted, everything not taken back yet.
	 */
	readonly reverse = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		lines: z
			.array(
				z
					.object({
						invoice_line_id: this.validateId(
							this.getMessage('invalid_invoice_line_id'),
						),
						quantity: this.validateNumber(
							this.getMessage('invalid_quantity'),
							{
								required: false,
								onlyPositive: true,
								allowDecimals: 2,
							},
						),
						amount: this.validateNumber(
							this.getMessage('invalid_amount'),
							{
								required: false,
								onlyPositive: true,
								allowDecimals: 2,
							},
						),
					})
					.refine(
						(item) =>
							(item.quantity === undefined) !==
							(item.amount === undefined),
						{ message: this.getMessage('invalid_reversal_line') },
					),
			)
			.min(1, { message: this.getMessage('invalid_lines') })
			.optional(),
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

	readonly paymentClear = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly paymentDelete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		payment_id: this.validateId(this.getMessage('invalid_payment_id')),
	});

	/** The buyer's own order whose documents and payments are asked for. */
	readonly publicBilling = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
	});

	/** One document of the buyer's own order, read to print. */
	readonly publicDocument = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});
}
