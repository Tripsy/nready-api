import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	STOCK_ADJUSTMENT_REASONS,
	StockAdjustmentDirectionEnum,
	StockAdjustmentReasonEnum,
	StockAdjustmentStatusEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	CREATED_AT: 'created_at',
	QTY: 'qty',
} as const;

/** `numeric(12,2)`, the shape `grn_item.qty` has - an adjustment never moves more than a lot holds. */
const QUANTITY_MAX = 9_999_999_999.99;

const NOTES_MAX = 2000;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_warehouse_id',
	'invalid_variant_id',
	'invalid_direction',
	'invalid_qty',
	'invalid_reason',
	'reason_direction',
] as const;

export class StockAdjustmentValidator extends BaseValidator<
	typeof validatorMessages
> {
	/**
	 * Units are stated as a positive quantity and a direction - "remove 3", not "-3" - which is how
	 * an operator thinks of it and leaves no sign to forget. To two decimals: stock is kept in `kg`
	 * and `litre` too.
	 */
	readonly create = z
		.object({
			warehouse_id: this.validateId(
				this.getMessage('invalid_warehouse_id'),
			),
			variant_id: this.validateId(this.getMessage('invalid_variant_id')),
			direction: this.validateEnum(
				StockAdjustmentDirectionEnum,
				this.getMessage('invalid_direction'),
			),
			qty: this.validateNumber(
				{
					invalid: this.getMessage('invalid_qty'),
					only_positive: this.getMessage('invalid_qty'),
					max_decimals: this.getMessage('invalid_qty'),
				},
				{ required: true, onlyPositive: true, allowDecimals: 2 },
			).refine((value) => value <= QUANTITY_MAX, {
				message: this.getMessage('invalid_qty'),
			}),
			reason: this.validateEnum(
				StockAdjustmentReasonEnum,
				this.getMessage('invalid_reason'),
			),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
				maxChars: NOTES_MAX,
			}),
		})
		// A reason belongs to a direction - nothing comes back into stock as "damaged"
		.superRefine((data, ctx) => {
			if (
				!STOCK_ADJUSTMENT_REASONS[data.direction].includes(data.reason)
			) {
				ctx.addIssue({
					path: ['reason'],
					message: this.getMessage('reason_direction'),
					code: 'custom',
				});
			}
		});

	readonly reverse = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.CREATED_AT,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			warehouse_id: this.validateId(
				this.getMessage('invalid_warehouse_id'),
				{ required: false },
			),
			variant_id: this.validateId(this.getMessage('invalid_variant_id'), {
				required: false,
			}),
			// Named apart from the listing's own `direction` (the sort order)
			adjustment_direction: this.validateEnum(
				StockAdjustmentDirectionEnum,
				this.getMessage('invalid_direction'),
				{ required: false },
			),
			reason: this.validateEnum(
				StockAdjustmentReasonEnum,
				this.getMessage('invalid_reason'),
				{ required: false },
			),
			status: this.validateEnum(
				StockAdjustmentStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			created_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			created_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
		},
	});
}
