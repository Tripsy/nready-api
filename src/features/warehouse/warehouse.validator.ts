import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { WarehouseStatusEnum } from '@/features/warehouse/warehouse.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'address_id',
	'code',
	'name',
	'is_default',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	CODE: 'code',
	NAME: 'name',
} as const;

/** Mirrors `varchar(16)` on `warehouse.code` - a longer value is a 422 here, not a masked 500. */
const CODE_MAX_CHARS = 16;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_name',
	'invalid_code',
	'invalid_address_id',
	'invalid_is_default',
] as const;

export class WarehouseValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly create = z.object({
		address_id: this.validateId(
			this.getMessage('invalid_address_id', { name: 'address_id' }),
		),
		code: this.validateString(this.getMessage('invalid_code'), {
			maxChars: CODE_MAX_CHARS,
		}),
		name: this.validateString(this.getMessage('invalid_name')),
		is_default: this.validateBoolean(
			this.getMessage('invalid_is_default'),
			{ required: false },
		).default(false),
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
			address_id: this.validateId(
				this.getMessage('invalid_address_id', { name: 'address_id' }),
				{ required: false },
			),
			code: this.validateString(this.getMessage('invalid_code'), {
				required: false,
				maxChars: CODE_MAX_CHARS,
			}),
			name: this.validateString(this.getMessage('invalid_name'), {
				required: false,
			}),
			is_default: this.validateBoolean(
				this.getMessage('invalid_is_default'),
				{ required: false },
			),
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

	readonly restore = z.object({
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
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			address_id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			status: this.validateEnum(
				WarehouseStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			is_default: this.validateBoolean(
				this.getMessage('invalid_is_default'),
				{ required: false },
			),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			WarehouseStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}
