import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	MANUAL_STATUSES,
	OrderReturnReasonEnum,
	OrderReturnStatusEnum,
} from '@/features/order-return/order-return.entity';
import { ShippingMethodEnum } from '@/features/shipping/shipping.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * What an update may change. `lines` and `reason` are taken only while the return is `requested`
 * - after that the return movement holds what travels (`OrderReturnService.updateData`).
 * `refund_shipping` only until the refund is drafted.
 */
export const paramsUpdateList: string[] = [
	'reason',
	'customer_notes',
	'response',
	'notes',
	'lines',
	'refund_shipping',
];

export const OrderByEnum = {
	ID: 'id',
	REF_NUMBER: 'ref_number',
	STATUS: 'status',
	CREATED_AT: 'created_at',
} as const;

// `numeric(12,2)` on the line, and on the shipping price the approval may state
const QUANTITY_MAX = 9_999_999_999.99;
const PRICE_MAX = 9_999_999_999.99;
const VAT_RATE_MAX = 100;

export const ORDER_RETURN_LINES_MAX = 200;
export const ORDER_RETURN_NOTES_MAX = 2000;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_order_id',
	'invalid_reason',
	'invalid_customer_notes',
	'invalid_response',
	'invalid_lines',
	'duplicate_variant',
	'invalid_variant_id',
	'invalid_quantity',
	'invalid_warehouse_id',
	'invalid_client_address_id',
	'invalid_carrier_id',
	'invalid_method',
	'invalid_price',
	'invalid_vat_rate',
	'price_vat_pair',
] as const;

export class OrderReturnValidator extends BaseValidator<
	typeof validatorMessages
> {
	private textSchema(
		key: 'invalid_notes' | 'invalid_customer_notes' | 'invalid_response',
	) {
		return this.validateString(this.getMessage(key), {
			required: false,
			maxChars: ORDER_RETURN_NOTES_MAX,
		});
	}

	private refundShippingSchema() {
		return this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).optional();
	}

	private idParam(name: string) {
		return this.validateId(this.getMessage('invalid_id', { name: name }));
	}

	/**
	 * One line, by variant - fractional quantity, as on every other line in the schema. No
	 * `product_id`: the service takes it from the order line the variant was sold on, so the pair
	 * cannot disagree.
	 */
	private lineSchema() {
		const quantityMessage = this.getMessage('invalid_quantity');

		return z.object({
			variant_id: this.validateId(this.getMessage('invalid_variant_id')),
			quantity: this.validateNumber(
				{
					invalid: quantityMessage,
					only_positive: quantityMessage,
					max_decimals: quantityMessage,
				},
				{ required: true, onlyPositive: true, allowDecimals: 2 },
			).refine((value) => value <= QUANTITY_MAX, {
				message: quantityMessage,
			}),
		});
	}

	/** At least one line, one per variant - `IDX_order_return_line_unique` would refuse a repeat. */
	private linesSchema() {
		return z
			.array(this.lineSchema())
			.min(1, { message: this.getMessage('invalid_lines') })
			.max(ORDER_RETURN_LINES_MAX, {
				message: this.getMessage('invalid_lines'),
			})
			.refine(
				(lines) =>
					new Set(lines.map((line) => line.variant_id)).size ===
					lines.length,
				{ message: this.getMessage('duplicate_variant') },
			);
	}

	private requestFields() {
		return {
			reason: this.validateEnum(
				OrderReturnReasonEnum,
				this.getMessage('invalid_reason'),
			),
			customer_notes: this.textSchema('invalid_customer_notes'),
			lines: this.linesSchema(),
		};
	}

	/** Back office: an operator raising a return for a client, on any order of theirs. */
	readonly create = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
		...this.requestFields(),
		notes: this.textSchema('invalid_notes'),
	});

	readonly read = z.object({
		id: this.idParam('id'),
	});

	readonly update = z
		.object({
			id: this.idParam('id'),
			reason: this.validateEnum(
				OrderReturnReasonEnum,
				this.getMessage('invalid_reason'),
				{ required: false },
			).optional(),
			customer_notes: this.textSchema('invalid_customer_notes'),
			response: this.textSchema('invalid_response'),
			notes: this.textSchema('invalid_notes'),
			lines: this.linesSchema().optional(),
			refund_shipping: this.refundShippingSchema(),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly delete = z.object({
		id: this.idParam('id'),
	});

	readonly restore = z.object({
		id: this.idParam('id'),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateIdFilter(this.getMessage('invalid_id'), {
				required: false,
			}),
			order_id: this.validateId(this.getMessage('invalid_order_id'), {
				required: false,
			}),
			status: this.validateEnum(
				OrderReturnStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			reason: this.validateEnum(
				OrderReturnReasonEnum,
				this.getMessage('invalid_reason'),
				{ required: false },
			),
			create_date_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			create_date_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: 1,
			}),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});

	/** Only the moves the route takes - `approved` and `received` have their own way in. */
	readonly statusUpdate = z.object({
		id: this.idParam('id'),
		status: z.enum(MANUAL_STATUSES, {
			message: this.getMessage('invalid_status'),
		}),
		response: this.textSchema('invalid_response'),
	});

	/**
	 * Approving writes the return movement. Everything defaults from the order's deliveries: the
	 * goods go back to the warehouse they left from, are collected at the address they went to, in
	 * that delivery's currency. `price` and `vat_rate` travel as a pair like on a shipping create;
	 * left out, the return is free to the buyer.
	 */
	readonly approve = z
		.object({
			id: this.idParam('id'),
			// Left out, the warehouse the delivered goods left from
			destination_warehouse_id: this.validateId(
				this.getMessage('invalid_warehouse_id'),
				{ required: false },
			),
			pickup_client_address_id: this.validateId(
				this.getMessage('invalid_client_address_id'),
				{ required: false },
			),
			carrier_id: this.validateId(this.getMessage('invalid_carrier_id'), {
				required: false,
			}),
			method: this.validateEnum(
				ShippingMethodEnum,
				this.getMessage('invalid_method'),
				{ required: false },
			).optional(),
			price: this.validateNumber(this.getMessage('invalid_price'), {
				required: false,
				onlyPositive: false,
				allowDecimals: 2,
			}).refine(
				(value) =>
					value === undefined ||
					value === null ||
					(value >= 0 && value <= PRICE_MAX),
				{ message: this.getMessage('invalid_price') },
			),
			vat_rate: this.validateNumber(this.getMessage('invalid_vat_rate'), {
				required: false,
				onlyPositive: false,
				allowDecimals: 2,
			}).refine(
				(value) =>
					value === undefined ||
					value === null ||
					(value >= 0 && value <= VAT_RATE_MAX),
				{ message: this.getMessage('invalid_vat_rate') },
			),
			response: this.textSchema('invalid_response'),
			// Left out, the outbound delivery fee is not paid back with the goods
			refund_shipping: this.refundShippingSchema(),
		})
		.refine(
			(data) =>
				(data.price === undefined || data.price === null) ===
				(data.vat_rate === undefined || data.vat_rate === null),
			{
				message: this.getMessage('price_vat_pair'),
				path: ['price'],
			},
		);

	readonly refund = z.object({
		id: this.idParam('id'),
	});

	readonly returnable = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
	});

	// Storefront: the order comes from the path and is proven the caller's own by the service

	readonly publicFind = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
	});

	readonly publicCreate = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
		...this.requestFields(),
	});

	readonly publicCancel = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
		id: this.idParam('id'),
	});
}
