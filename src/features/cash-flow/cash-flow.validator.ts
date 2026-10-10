import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	AMOUNT_DECIMALS,
	CashFlowCategoryTypeEnum,
	CashFlowDirectionEnum,
	CashFlowMethodEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import { CashFlowCategoryEnum } from '@/features/cash-flow/cash-flow-category.enum';
import { OperationalRecordTypeEnum } from '@/features/cash-flow/operational-record.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, normalizeCurrency } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'direction',
	'category_type',
	'category',
	'method',
	'amount',
	'vat_rate',
	'currency',
	'external_reference',
	'notes',
	// The individual records are nested under this one key in the update schema
	'operational_records',
];

/**
 * The subset of `paramsUpdateList` that restates the movement itself, and so is refused once the
 * entry has left `MUTABLE_STATUSES`.
 *
 * `operational_records` is deliberately absent: what a movement is filed under is bookkeeping
 * rather than money, and an operator matching a captured payment to the order it turns out to
 * belong to must not be blocked by the status that capture put it in. See `updateData`.
 */
export const paramsRestatingEntry: string[] = paramsUpdateList.filter(
	(param) => param !== 'operational_records',
);

export const OrderByEnum = {
	ID: 'id',
	CATEGORY: 'category',
	METHOD: 'method',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_direction',
	'invalid_category_type',
	'invalid_category',
	'invalid_gateway',
	'invalid_method',
	'invalid_amount',
	'invalid_vat_rate',
	'invalid_currency',
	'invalid_exchange_rate',
	'invalid_external_reference',
	'invalid_parent_id',
	'invalid_status',
] as const;

export class CashFlowValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * A three-letter ISO code, normalized here so the movement is written the one way a later
	 * comparison against the document it settles matches.
	 */
	private currencySchema(): z.ZodType<string> {
		return this.validateString(this.getMessage('invalid_currency'), {
			required: true,
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		}).transform(normalizeCurrency);
	}

	readonly operationalRecordsSchema = z
		.object({
			[OperationalRecordTypeEnum.CLIENT]: this.validateId(
				this.getMessage('invalid_number'),
				{ required: false },
			),
			[OperationalRecordTypeEnum.VENDOR]: this.validateId(
				this.getMessage('invalid_number'),
				{ required: false },
			),
			[OperationalRecordTypeEnum.ORDER]: this.validateId(
				this.getMessage('invalid_number'),
				{ required: false },
			),
		})
		.optional();

	readonly create = z.object({
		direction: this.validateEnum(
			CashFlowDirectionEnum,
			this.getMessage('invalid_direction'),
		),
		category_type: this.validateEnum(
			CashFlowCategoryTypeEnum,
			this.getMessage('invalid_category_type'),
		),
		category: this.validateEnum(
			CashFlowCategoryEnum,
			this.getMessage('invalid_category'),
		),
		method: this.validateEnum(
			CashFlowMethodEnum,
			this.getMessage('invalid_method'),
		),
		amount: this.validateNumber(this.getMessage('invalid_amount'), {
			required: true,
			onlyPositive: false,
			allowDecimals: AMOUNT_DECIMALS,
		}),
		vat_rate: this.validateNumber(this.getMessage('invalid_vat_rate'), {
			required: true,
			onlyPositive: true,
			allowDecimals: 2,
		}),
		// Optional: the service applies the deployment's configured currency when omitted
		currency: this.currencySchema().optional(),
		external_reference: this.validateString(
			this.getMessage('invalid_external_reference'),
			{ required: false },
		),
		parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
			required: false,
		}),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
		operational_records: this.operationalRecordsSchema,
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			direction: this.validateEnum(
				CashFlowDirectionEnum,
				this.getMessage('invalid_direction'),
				{ required: false },
			),
			category_type: this.validateEnum(
				CashFlowCategoryTypeEnum,
				this.getMessage('invalid_category_type'),
				{ required: false },
			),
			category: this.validateEnum(
				CashFlowCategoryEnum,
				this.getMessage('invalid_category'),
				{ required: false },
			),
			method: this.validateEnum(
				CashFlowMethodEnum,
				this.getMessage('invalid_method'),
				{ required: false },
			),
			amount: this.validateNumber(this.getMessage('invalid_amount'), {
				required: false,
				onlyPositive: false,
				allowDecimals: AMOUNT_DECIMALS,
			}),
			vat_rate: this.validateNumber(this.getMessage('invalid_vat_rate'), {
				required: false,
				onlyPositive: true,
				allowDecimals: 2,
			}),
			currency: this.currencySchema().optional(),
			external_reference: this.validateString(
				this.getMessage('invalid_external_reference'),
				{ required: false },
			),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
			operational_records: this.operationalRecordsSchema,
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		// Used to force deletion even when selected entry has refunds (which will also be deleted)
		force: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).default(false),
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
			parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
				required: false,
			}),
			direction: this.validateEnum(
				CashFlowDirectionEnum,
				this.getMessage('invalid_direction'),
				{ required: false },
			),
			category_type: this.validateEnum(
				CashFlowCategoryTypeEnum,
				this.getMessage('invalid_category_type'),
				{ required: false },
			),
			category: this.validateEnum(
				CashFlowCategoryEnum,
				this.getMessage('invalid_category'),
				{ required: false },
			),
			method: this.validateEnum(
				CashFlowMethodEnum,
				this.getMessage('invalid_method'),
				{ required: false },
			),
			status: this.validateEnum(
				CashFlowStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			currency: this.currencySchema().optional(),
			create_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			create_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			client_id: this.validateId(this.getMessage('invalid_number'), {
				required: false,
			}),
			vendor_id: this.validateId(this.getMessage('invalid_number'), {
				required: false,
			}),
			order_id: this.validateId(this.getMessage('invalid_number'), {
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
			CashFlowStatusEnum,
			this.getMessage('invalid_status'),
		),
	});

	readonly operationalRecords = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});
}
