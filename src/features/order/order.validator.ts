import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { OrderStatusEnum, OrderTypeEnum } from '@/features/order/order.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, normalizeCurrency } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * What an update may change on the document itself. The lines are not here - they are replaced
 * wholesale by their own key and only while the order is pending, so they cannot be folded into
 * the `pickValuesFromObject` pass the other columns go through.
 *
 * `status` is absent for the usual reason: it moves only through its own route, along the
 * transitions the entity declares.
 */
export const paramsUpdateList: string[] = [
	'client_id',
	'billing_address_id',
	'type',
	'issued_at',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	REF_NUMBER: 'ref_number',
	ISSUED_AT: 'issued_at',
	STATUS: 'status',
	CREATED_AT: 'created_at',
} as const;

/**
 * The column bounds, mirrored so an oversized figure answers 422 instead of reaching Postgres as a
 * numeric overflow - which the error handler masks into a 500 that says nothing.
 *
 * `vat_rate` is the exception: `numeric(5,2)` would take 999.99, but a rate above 100% is not a
 * rate, and no jurisdiction the settings can describe has one.
 */
const QUANTITY_MAX = 99_999;
const PRICE_MAX = 9_999_999_999.99;
const VAT_RATE_MAX = 100;

/** One request's ceiling on how much document it may compose in a single call. */
export const ORDER_LINES_MAX = 200;

/** The most answers one line may carry, a bound on the payload rather than a catalog rule. */
export const ORDER_LINE_OPTIONS_MAX = 20;

export const ORDER_NOTES_MAX = 2000;

/** Mirrors `varchar(10)` on `order.ref_code`. */
const REF_CODE_MAX_CHARS = 10;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_client_id',
	'invalid_billing_address_id',
	'invalid_currency',
	'invalid_type',
	'invalid_lines',
	'invalid_variant_id',
	'invalid_product_id',
	'invalid_quantity',
	'invalid_price',
	'invalid_vat_rate',
	'invalid_options',
	'invalid_ref_code',
	'invalid_ref_number',
	'currency_needs_lines',
] as const;

export class OrderValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * A quantity may be fractional - `product.unit` allows `kg` and `liter` - so this is not an
	 * integer check. The column is `numeric(12,2)` under a `quantity > 0` check constraint, and
	 * both halves of that are stated here.
	 */
	private quantitySchema(): z.ZodType<number> {
		const message = this.getMessage('invalid_quantity');

		return this.validateNumber(
			{
				invalid: message,
				only_positive: message,
				no_decimals: message,
			},
			{ required: true, onlyPositive: true, allowDecimals: 2 },
		).refine((value) => value <= QUANTITY_MAX, { message: message });
	}

	/**
	 * Zero is legal, and not an oversight: a bundle header line carries no money of its own while
	 * the component lines it explodes into carry all of it. `onlyPositive` would refuse the shape
	 * the database's own `price >= 0` check allows.
	 */
	private priceSchema(): z.ZodType<number> {
		const message = this.getMessage('invalid_price');

		return this.validateNumber(
			{ invalid: message, no_decimals: message },
			{ required: true, allowDecimals: 2 },
		).refine((value) => value >= 0 && value <= PRICE_MAX, {
			message: message,
		});
	}

	private vatRateSchema(): z.ZodType<number> {
		const message = this.getMessage('invalid_vat_rate');

		return this.validateNumber(
			{ invalid: message, no_decimals: message },
			{ required: true, allowDecimals: 2 },
		).refine((value) => value >= 0 && value <= VAT_RATE_MAX, {
			message: message,
		});
	}

	private notesSchema() {
		return this.validateString(this.getMessage('invalid_notes'), {
			required: false,
			maxChars: ORDER_NOTES_MAX,
		}).optional();
	}

	/**
	 * A three-letter ISO code, normalized here so the document is written the one way a later
	 * currency comparison matches.
	 */
	private currencySchema(): z.ZodType<string> {
		return this.validateString(this.getMessage('invalid_currency'), {
			required: true,
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		}).transform(normalizeCurrency);
	}

	/**
	 * The date the document is issued on. Backdating is allowed - a phone order typed up the next
	 * morning is issued the day it was taken - and the default is now, applied by the service.
	 */
	private issuedAtSchema() {
		return this.validateDate(
			{
				invalid_date: this.getMessage('invalid_date'),
				invalid_date_format: this.getMessage('invalid_date_format'),
			},
			{ required: false, requireTime: false },
		);
	}

	/**
	 * One line of a back-office document.
	 *
	 * **The price is the caller's**, as it is for every other writer of an order: the operator
	 * taking the call agrees a figure, and this is where it stops moving - with the deltas of any
	 * chosen options already folded in, the way a checkout line states it.
	 *
	 * **`options` are `product_option` ids, not snapshots.** `OrderService` resolves them against
	 * the catalog - each must belong to the line's product, and every question on it must get
	 * between `min_select` and `max_select` answers - and writes the snapshot itself, so a caller
	 * cannot record a label or a delta the catalog does not hold. Whether an id is one of the
	 * product's is not a shape question and is answered there.
	 *
	 * **Discounts are absent because they are not the operator's to state.** `OrderService`
	 * resolves the catalog's own rules over the set as it is saved, the same ones the storefront
	 * applies, and writes what they took off onto each line - so a campaign reaches a phone order
	 * without anybody remembering it, and cannot be handed out by typing one into the payload.
	 *
	 * `product_id` travels with `variant_id` because the row holds both under a composite foreign
	 * key. The pair is checked before the insert (`OrderService.checkLines`) rather than left to
	 * that key, which would answer a mismatch with a masked 500.
	 */
	private lineSchema() {
		return z.object({
			variant_id: this.validateId(this.getMessage('invalid_variant_id')),
			product_id: this.validateId(this.getMessage('invalid_product_id')),
			quantity: this.quantitySchema(),
			price: this.priceSchema(),
			vat_rate: this.vatRateSchema(),
			options: z
				.array(
					this.validateId(this.getMessage('invalid_options'), {
						required: true,
					}),
				)
				.max(ORDER_LINE_OPTIONS_MAX, {
					message: this.getMessage('invalid_options'),
				})
				.optional(),
			notes: this.notesSchema(),
		});
	}

	private linesSchema() {
		const message = this.getMessage('invalid_lines');

		return z
			.array(this.lineSchema())
			.min(1, { message: message })
			.max(ORDER_LINES_MAX, { message: message });
	}

	/**
	 * Composing a document in the back office - an order taken by phone or in person. It enters at
	 * `pending`, exactly as a checkout's order does, and `OrderService` allocates its series
	 * number on the way in, so the reference exists from the first save.
	 */
	readonly create = z.object({
		client_id: this.validateId(this.getMessage('invalid_client_id')),
		/*
		 * Optional, and not checked against the client here: whether the address is one the billed
		 * client holds is a data question, answered by `OrderService` against `client_address`,
		 * which owns the 404 either way.
		 */
		billing_address_id: this.validateId(
			this.getMessage('invalid_billing_address_id'),
			{ required: false },
		),
		currency: this.currencySchema(),
		type: this.validateEnum(
			OrderTypeEnum,
			this.getMessage('invalid_type'),
			{
				required: false,
			},
		),
		issued_at: this.issuedAtSchema(),
		notes: this.notesSchema(),
		lines: this.linesSchema(),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	/**
	 * `lines` replaces the whole set rather than patching one of them: a document is agreed as a
	 * whole, and a line-by-line surface would need an ownership check per line for no gain while
	 * the only editable state is `pending`. `OrderService` refuses it outright once the order has
	 * left `pending`.
	 *
	 * **`currency` travels with `lines` and is refused without them.** No order row holds a
	 * currency - each line carries its own - so the only way to re-denominate a document is to
	 * write its lines again. Accepting the code on its own would silently relabel figures nobody
	 * re-quoted. Being tied to `lines` also inherits their `pending` gate for free: the service
	 * answers 409 for a line set on a confirmed order, so the currency cannot move past that point
	 * either.
	 *
	 * The rate is not a payload field on either action - `OrderService` reads it from
	 * `exchange_rate` for the document's own issue date.
	 */
	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			client_id: this.validateId(this.getMessage('invalid_client_id'), {
				required: false,
			}),
			billing_address_id: this.validateId(
				this.getMessage('invalid_billing_address_id'),
				{ required: false },
			),
			currency: this.currencySchema().optional(),
			type: this.validateEnum(
				OrderTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			issued_at: this.issuedAtSchema(),
			notes: this.notesSchema(),
			lines: this.linesSchema().optional(),
		})
		.refine(
			(data) =>
				hasAtLeastOneValue(data, [
					...paramsUpdateList,
					'currency',
					'lines',
				]),
			{
				message: this.getMessage('params_at_least_one', {
					params: [...paramsUpdateList, 'currency', 'lines'].join(
						', ',
					),
				}),
				path: ['_global'],
			},
		)
		.refine(
			(data) => data.lines !== undefined || data.currency === undefined,
			{
				message: this.getMessage('currency_needs_lines'),
				path: ['currency'],
			},
		);

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ISSUED_AT,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateIdFilter(this.getMessage('invalid_id'), {
				required: false,
			}),
			client_id: this.validateId(this.getMessage('invalid_client_id'), {
				required: false,
			}),
			status: this.validateEnum(
				OrderStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			type: this.validateEnum(
				OrderTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			/*
			 * The two halves of the reference, filterable on their own: a series code narrows the
			 * list to one document type's numbering, and the number alone is what somebody reads
			 * off a printed order when they cannot remember the code.
			 */
			ref_code: this.validateString(this.getMessage('invalid_ref_code'), {
				required: false,
				maxChars: REF_CODE_MAX_CHARS,
			}),
			ref_number: this.validateNumber(
				this.getMessage('invalid_ref_number'),
				{ required: false, onlyPositive: true },
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
				minChars: Configuration.get('filter.termMinLength'),
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
			OrderStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}
