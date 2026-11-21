import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { GrnStatusEnum } from '@/features/grn/grn.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, normalizeCurrency } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * What an update may change. `items` replaces the whole line set, the same way a shipment's lines
 * do - see `GrnService.updateData`, which also decides which of these a non-draft receipt still
 * accepts. `status` moves only through its own route, and `ref_code` / `ref_number` belong to the
 * series that allocated them.
 */
export const paramsUpdateList: string[] = [
	'warehouse_id',
	'vendor_id',
	'supplier_document_number',
	'received_at',
	'currency',
	'exchange_rate',
	'notes',
	'items',
];

export const OrderByEnum = {
	ID: 'id',
	REF_NUMBER: 'ref_number',
	STATUS: 'status',
	RECEIVED_AT: 'received_at',
	CREATED_AT: 'created_at',
} as const;

/** Cost-over-floor is always listed tightest first; the one value keeps `validateFind`'s shape honest. */
export const CostOverFloorOrderByEnum = {
	GAP: 'gap',
} as const;

/*
 * Mirror the column bounds, so an oversized figure answers 422 rather than the masked 500 the
 * database would raise: `numeric(12,2)` for quantities and unit cost, `numeric(10,6)` for the rate,
 * `numeric(5,2)` for the VAT rate.
 */
const QUANTITY_MAX = 9_999_999_999.99;
const UNIT_COST_MAX = 9_999_999_999.99;
const EXCHANGE_RATE_MAX = 9_999.999999;
const VAT_RATE_MAX = 100;

/** One request's ceiling on how many lines a single receipt may carry. */
export const GRN_ITEMS_MAX = 500;

export const GRN_NOTES_MAX = 2000;
export const GRN_SUPPLIER_DOCUMENT_MAX = 100;
export const GRN_LOT_CODE_MAX = 100;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_warehouse_id',
	'invalid_vendor_id',
	'invalid_supplier_document_number',
	'invalid_received_at',
	'invalid_currency',
	'invalid_exchange_rate',
	'invalid_items',
	'duplicate_variant',
	'invalid_variant_id',
	'invalid_qty',
	'invalid_unit_cost',
	'invalid_vat_rate',
	'invalid_lot_code',
	'invalid_expires_at',
] as const;

export class GrnValidator extends BaseValidator<typeof validatorMessages> {
	private notesSchema() {
		return this.validateString(this.getMessage('invalid_notes'), {
			required: false,
			maxChars: GRN_NOTES_MAX,
		});
	}

	private currencySchema(): z.ZodType<string> {
		return this.validateString(this.getMessage('invalid_currency'), {
			required: true,
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		}).transform(normalizeCurrency);
	}

	/**
	 * Optional everywhere: left out, it is resolved from the published rate of the receiving day.
	 * Stated, it is taken as the rate the supplier's invoice was actually converted at.
	 */
	private exchangeRateSchema() {
		const message = this.getMessage('invalid_exchange_rate');

		return this.validateNumber(
			{ invalid: message, only_positive: message, max_decimals: message },
			{ required: false, onlyPositive: true, allowDecimals: 6 },
		).refine(
			(value) =>
				value === undefined ||
				value === null ||
				value <= EXCHANGE_RATE_MAX,
			{ message: message },
		);
	}

	private receivedAtSchema() {
		return {
			invalid_date: this.getMessage('invalid_received_at'),
			invalid_date_format: this.getMessage('invalid_date_format'),
		};
	}

	/**
	 * One received line - and the lot it opens on confirmation.
	 *
	 * Fractional quantity, like every other quantity in the schema: `product.unit` allows `kg` and
	 * `litre`. Whether the variant exists and is stock-tracked is a data question `GrnService`
	 * answers; this schema only proves the shape and the column bounds.
	 */
	private itemSchema() {
		const qtyMessage = this.getMessage('invalid_qty');
		const unitCostMessage = this.getMessage('invalid_unit_cost');
		const vatRateMessage = this.getMessage('invalid_vat_rate');

		return z.object({
			variant_id: this.validateId(this.getMessage('invalid_variant_id')),
			qty: this.validateNumber(
				{
					invalid: qtyMessage,
					only_positive: qtyMessage,
					max_decimals: qtyMessage,
				},
				{ required: true, onlyPositive: true, allowDecimals: 2 },
			).refine((value) => value <= QUANTITY_MAX, {
				message: qtyMessage,
			}),
			// Zero is accepted: free samples and replacement goods are received at no cost
			unit_cost: this.validateNumber(
				{ invalid: unitCostMessage, max_decimals: unitCostMessage },
				{ required: true, onlyPositive: false, allowDecimals: 2 },
			).refine((value) => value >= 0 && value <= UNIT_COST_MAX, {
				message: unitCostMessage,
			}),
			vat_rate: this.validateNumber(
				{ invalid: vatRateMessage, max_decimals: vatRateMessage },
				{ required: false, onlyPositive: false, allowDecimals: 2 },
			).refine(
				(value) =>
					value === undefined ||
					value === null ||
					(value >= 0 && value <= VAT_RATE_MAX),
				{ message: vatRateMessage },
			),
			lot_code: this.validateString(this.getMessage('invalid_lot_code'), {
				required: false,
				maxChars: GRN_LOT_CODE_MAX,
			}),
			expires_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_expires_at'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			notes: this.notesSchema(),
		});
	}

	/**
	 * At most one line per variant: `IDX_grn_item_unique` refuses a second, and refuses it as a
	 * masked 500. Two lots of one variant in one delivery are entered as two receipts - see the
	 * comment on that index.
	 */
	private itemsSchema() {
		return z
			.array(this.itemSchema())
			.max(GRN_ITEMS_MAX, { message: this.getMessage('invalid_items') })
			.refine(
				(items) =>
					new Set(items.map((item) => item.variant_id)).size ===
					items.length,
				{ message: this.getMessage('duplicate_variant') },
			);
	}

	/**
	 * A new receipt always starts as `draft` and holds no stock, so it may be created with no lines
	 * at all and filled in afterwards; confirmation is what requires them.
	 */
	readonly create = z.object({
		warehouse_id: this.validateId(this.getMessage('invalid_warehouse_id')),
		vendor_id: this.validateId(this.getMessage('invalid_vendor_id')),
		supplier_document_number: this.validateString(
			this.getMessage('invalid_supplier_document_number'),
			{ required: false, maxChars: GRN_SUPPLIER_DOCUMENT_MAX },
		),
		received_at: this.validateDate(this.receivedAtSchema(), {
			requireTime: false,
		}),
		currency: this.currencySchema(),
		exchange_rate: this.exchangeRateSchema(),
		notes: this.notesSchema(),
		items: this.itemsSchema().optional(),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			warehouse_id: this.validateId(
				this.getMessage('invalid_warehouse_id'),
				{ required: false },
			),
			vendor_id: this.validateId(this.getMessage('invalid_vendor_id'), {
				required: false,
			}),
			supplier_document_number: this.validateString(
				this.getMessage('invalid_supplier_document_number'),
				{ required: false, maxChars: GRN_SUPPLIER_DOCUMENT_MAX },
			),
			received_at: this.validateDate(this.receivedAtSchema(), {
				required: false,
				requireTime: false,
			}),
			currency: this.currencySchema().optional(),
			exchange_rate: this.exchangeRateSchema(),
			notes: this.notesSchema(),
			items: this.itemsSchema().optional(),
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

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
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
			warehouse_id: this.validateId(
				this.getMessage('invalid_warehouse_id'),
				{ required: false },
			),
			vendor_id: this.validateId(this.getMessage('invalid_vendor_id'), {
				required: false,
			}),
			status: this.validateEnum(
				GrnStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			received_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			received_at_end: this.validateDate(
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

	readonly costOverFloor = this.validateFind({
		orderByEnum: CostOverFloorOrderByEnum,
		defaultOrderBy: CostOverFloorOrderByEnum.GAP,

		directionEnum: { ASC: OrderDirectionEnum.ASC },
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {},
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			GrnStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}
