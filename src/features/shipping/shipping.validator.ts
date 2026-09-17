import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	ShippingMethodEnum,
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, normalizeCurrency } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * What an update may change on the movement itself.
 *
 * **`scope` is absent, and that is the point of it being write-once**: changing it would re-point
 * both ends at other tables while the allocation, the frozen snapshots and any stock already posted
 * still describe the old shape.
 *
 * `order_id` and `document_ref` are absent for the neighbouring reason - moving a movement to
 * another document would take its allocation with it, and the allocation only means anything
 * against the document it was cut from. `status` moves only through its own route.
 */
export const paramsUpdateList: string[] = [
	'pickup_warehouse_id',
	'pickup_client_address_id',
	'destination_warehouse_id',
	'destination_client_address_id',
	'carrier_id',
	'method',
	'tracking_number',
	'tracking_url',
	'vat_rate',
	'price',
	'operational_cost',
	'currency',
	'contact_name',
	'contact_phone',
	'contact_email',
	'estimated_delivery_at',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	STATUS: 'status',
	SHIPPED_AT: 'shipped_at',
	CREATED_AT: 'created_at',
} as const;

/** Mirrors the column bounds, so an oversized figure answers 422 rather than a masked 500. */
const PRICE_MAX = 9_999_999_999.99;
const VAT_RATE_MAX = 100;
const QUANTITY_MAX = 99_999;

/** One request's ceiling on how many variants a single movement may carry. */
export const SHIPPING_LINES_MAX = 200;

export const SHIPPING_NOTES_MAX = 2000;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_scope',
	'invalid_order_id',
	'invalid_document_ref',
	'invalid_pickup_warehouse_id',
	'invalid_pickup_client_address_id',
	'invalid_destination_warehouse_id',
	'invalid_destination_client_address_id',
	'invalid_carrier_id',
	'invalid_method',
	'invalid_tracking_number',
	'invalid_tracking_url',
	'invalid_price',
	'invalid_operational_cost',
	'invalid_vat_rate',
	'price_needs_vat_rate',
	'invalid_currency',
	'invalid_contact_name',
	'invalid_contact_phone',
	'invalid_contact_email',
	'invalid_lines',
	'invalid_variant_id',
	'invalid_product_id',
	'invalid_quantity',
] as const;

export class ShippingValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * Always built as required; the update schema wraps it in `.optional()` instead. The option is
	 * a literal type on `validateNumber`, so a caller's boolean cannot pick between its overloads.
	 */
	private priceSchema(): z.ZodType<number> {
		const message = this.getMessage('invalid_price');

		return this.validateNumber(
			{ invalid: message, no_decimals: message },
			// Not the helper's positive default: a checkout writes its shipment at zero
			{ required: true, onlyPositive: false, allowDecimals: 2 },
		).refine((value) => value >= 0 && value <= PRICE_MAX, {
			message: message,
		});
	}

	/**
	 * Optional on both create and update: the figure usually arrives after the parcel has gone,
	 * with the carrier's invoice. Zero is accepted - a self-pickup costs nothing.
	 */
	private operationalCostSchema() {
		const message = this.getMessage('invalid_operational_cost');

		return this.validateNumber(
			{ invalid: message, max_decimals: message },
			{ required: false, onlyPositive: false, allowDecimals: 2 },
		).refine(
			(value) =>
				value === undefined ||
				value === null ||
				(value >= 0 && value <= PRICE_MAX),
			{ message: message },
		);
	}

	private vatRateSchema(): z.ZodType<number> {
		const message = this.getMessage('invalid_vat_rate');

		return this.validateNumber(
			{ invalid: message, no_decimals: message },
			{ required: true, onlyPositive: false, allowDecimals: 2 },
		).refine((value) => value >= 0 && value <= VAT_RATE_MAX, {
			message: message,
		});
	}

	private currencySchema(): z.ZodType<string> {
		return this.validateString(this.getMessage('invalid_currency'), {
			required: true,
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		}).transform(normalizeCurrency);
	}

	private notesSchema() {
		return this.validateString(this.getMessage('invalid_notes'), {
			required: false,
			maxChars: SHIPPING_NOTES_MAX,
		}).optional();
	}

	/**
	 * One line: how much of a variant travels in this movement.
	 *
	 * Fractional, like the order line it may draw from - `product.unit` allows `kg` and `litre`.
	 * Whether the quantity is still available against the movement's order is a data question
	 * answered by `ShippingService`, which can see the order's other movements; this schema can not.
	 */
	private lineSchema() {
		const quantityMessage = this.getMessage('invalid_quantity');

		return z.object({
			variant_id: this.validateId(this.getMessage('invalid_variant_id')),
			product_id: this.validateId(this.getMessage('invalid_product_id')),
			quantity: this.validateNumber(
				{
					invalid: quantityMessage,
					only_positive: quantityMessage,
					no_decimals: quantityMessage,
				},
				{ required: true, onlyPositive: true, allowDecimals: 2 },
			).refine((value) => value <= QUANTITY_MAX, {
				message: quantityMessage,
			}),
			notes: this.notesSchema(),
		});
	}

	private linesSchema() {
		const message = this.getMessage('invalid_lines');

		return z
			.array(this.lineSchema())
			.max(SHIPPING_LINES_MAX, { message: message });
	}

	private contactSchema() {
		return {
			contact_name: this.validateString(
				this.getMessage('invalid_contact_name'),
				{ required: false },
			),
			contact_phone: this.validateString(
				this.getMessage('invalid_contact_phone'),
				{ required: false },
			),
			contact_email: this.validateString(
				this.getMessage('invalid_contact_email'),
				{ required: false },
			),
		};
	}

	/** The two ends and the two documents, each optional here and resolved against `scope`. */
	private referenceSchema() {
		return {
			order_id: this.validateId(this.getMessage('invalid_order_id'), {
				required: false,
			}),
			document_ref: this.validateId(
				this.getMessage('invalid_document_ref'),
				{ required: false },
			),
			pickup_warehouse_id: this.validateId(
				this.getMessage('invalid_pickup_warehouse_id'),
				{ required: false },
			),
			pickup_client_address_id: this.validateId(
				this.getMessage('invalid_pickup_client_address_id'),
				{ required: false },
			),
			destination_warehouse_id: this.validateId(
				this.getMessage('invalid_destination_warehouse_id'),
				{ required: false },
			),
			destination_client_address_id: this.validateId(
				this.getMessage('invalid_destination_client_address_id'),
				{ required: false },
			),
		};
	}

	/**
	 * A movement of goods: out to a client, between two warehouses, or back from a client.
	 *
	 * **Every reference is optional in this schema and none of them is optional in practice.** Which
	 * two ends and which document a row needs is decided by `scope`, and that rule lives in
	 * `ShippingService` rather than being split between a Zod union here and the table's CHECK
	 * constraints - one statement of it, in the place that can also prove the ids resolve.
	 *
	 * A new movement always starts at `pending`, so `status` is not a field here.
	 */
	readonly create = z
		.object({
			scope: this.validateEnum(
				ShippingScopeEnum,
				this.getMessage('invalid_scope'),
			),
			method: this.validateEnum(
				ShippingMethodEnum,
				this.getMessage('invalid_method'),
			),
			...this.referenceSchema(),
			carrier_id: this.validateId(this.getMessage('invalid_carrier_id'), {
				required: false,
			}),
			tracking_number: this.validateString(
				this.getMessage('invalid_tracking_number'),
				{ required: false },
			),
			tracking_url: this.validateString(
				this.getMessage('invalid_tracking_url'),
				{ required: false },
			),
			/*
			 * Both optional: a price left out is quoted from the flat-rate table in `settings.shipping`,
			 * with the VAT rate that goes with it, and so is an operational cost - see
			 * `ShippingService.withRateDefaults`.
			 */
			price: this.priceSchema().optional(),
			operational_cost: this.operationalCostSchema(),
			vat_rate: this.vatRateSchema().optional(),
			currency: this.currencySchema(),
			...this.contactSchema(),
			estimated_delivery_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false, requireTime: false },
			),
			notes: this.notesSchema(),
			lines: this.linesSchema().optional(),
		})
		/*
		 * The two are quoted as a pair - the net price is split out of the VAT-inclusive rate at a
		 * VAT rate - so stating one and not the other would have the quote overwrite the figure the
		 * operator did type. Both or neither.
		 */
		.refine(
			(data) =>
				(data.price === undefined) === (data.vat_rate === undefined),
			{
				message: this.getMessage('price_needs_vat_rate'),
				path: ['price'],
			},
		);

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	/**
	 * `lines` replaces the whole set rather than patching one of them: what travels together is
	 * decided as a set, and the remaining-quantity check reads across the document's other movements
	 * either way.
	 *
	 * `scope` is not accepted, and a body carrying one is ignored rather than refused - the same way
	 * `status` is. What the scope fixed at creation cannot be edited afterwards.
	 */
	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			method: this.validateEnum(
				ShippingMethodEnum,
				this.getMessage('invalid_method'),
				{ required: false },
			),
			pickup_warehouse_id: this.validateId(
				this.getMessage('invalid_pickup_warehouse_id'),
				{ required: false },
			),
			pickup_client_address_id: this.validateId(
				this.getMessage('invalid_pickup_client_address_id'),
				{ required: false },
			),
			destination_warehouse_id: this.validateId(
				this.getMessage('invalid_destination_warehouse_id'),
				{ required: false },
			),
			destination_client_address_id: this.validateId(
				this.getMessage('invalid_destination_client_address_id'),
				{ required: false },
			),
			carrier_id: this.validateId(this.getMessage('invalid_carrier_id'), {
				required: false,
			}),
			tracking_number: this.validateString(
				this.getMessage('invalid_tracking_number'),
				{ required: false },
			),
			tracking_url: this.validateString(
				this.getMessage('invalid_tracking_url'),
				{ required: false },
			),
			price: this.priceSchema().optional(),
			operational_cost: this.operationalCostSchema(),
			vat_rate: this.vatRateSchema().optional(),
			currency: this.currencySchema().optional(),
			...this.contactSchema(),
			estimated_delivery_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false, requireTime: false },
			),
			notes: this.notesSchema(),
			lines: this.linesSchema().optional(),
		})
		.refine(
			(data) => hasAtLeastOneValue(data, [...paramsUpdateList, 'lines']),
			{
				message: this.getMessage('params_at_least_one', {
					params: [...paramsUpdateList, 'lines'].join(', '),
				}),
				path: ['_global'],
			},
		);

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	/** The order a buyer asks about. Ownership is resolved by the service, not here. */
	readonly publicFind = z.object({
		order_id: this.validateId(this.getMessage('invalid_order_id')),
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
			scope: this.validateEnum(
				ShippingScopeEnum,
				this.getMessage('invalid_scope'),
				{ required: false },
			),
			order_id: this.validateId(this.getMessage('invalid_order_id'), {
				required: false,
			}),
			document_ref: this.validateId(
				this.getMessage('invalid_document_ref'),
				{ required: false },
			),
			pickup_warehouse_id: this.validateId(
				this.getMessage('invalid_pickup_warehouse_id'),
				{ required: false },
			),
			destination_warehouse_id: this.validateId(
				this.getMessage('invalid_destination_warehouse_id'),
				{ required: false },
			),
			carrier_id: this.validateId(this.getMessage('invalid_carrier_id'), {
				required: false,
			}),
			status: this.validateEnum(
				ShippingStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			method: this.validateEnum(
				ShippingMethodEnum,
				this.getMessage('invalid_method'),
				{ required: false },
			),
			shipped_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			shipped_at_end: this.validateDate(
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
			ShippingStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}
