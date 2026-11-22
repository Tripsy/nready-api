import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	OCCURRED_AT: 'occurred_at',
	QTY: 'qty',
} as const;

/** Low-stock is always listed lowest first; the one value keeps `validateFind`'s shape honest. */
export const LowStockOrderByEnum = {
	AVAILABLE: 'available',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_warehouse_id',
	'invalid_variant_id',
	'invalid_grn_item_id',
	'invalid_movement_type',
	'invalid_source_type',
	'invalid_source_id',
	'invalid_reversal_of_id',
] as const;

export class WarehouseMovementValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly stock = z.object({
		variant_id: this.validateId(this.getMessage('invalid_variant_id')),
	});

	readonly lowStock = this.validateFind({
		orderByEnum: LowStockOrderByEnum,
		defaultOrderBy: LowStockOrderByEnum.AVAILABLE,

		directionEnum: { ASC: OrderDirectionEnum.ASC },
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {},
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.OCCURRED_AT,

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
			grn_item_id: this.validateId(
				this.getMessage('invalid_grn_item_id'),
				{ required: false },
			),
			movement_type: this.validateEnum(
				WarehouseMovementTypeEnum,
				this.getMessage('invalid_movement_type'),
				{ required: false },
			),
			source_type: this.validateEnum(
				WarehouseMovementSourceEnum,
				this.getMessage('invalid_source_type'),
				{ required: false },
			),
			source_id: this.validateId(this.getMessage('invalid_source_id'), {
				required: false,
			}),
			reversal_of_id: this.validateId(
				this.getMessage('invalid_reversal_of_id'),
				{ required: false },
			),
			occurred_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
			occurred_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
				},
				{ required: false },
			),
		},
	});
}
