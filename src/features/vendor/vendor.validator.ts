import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	VendorStatusEnum,
	VendorTypeEnum,
} from '@/features/vendor/vendor.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = ['name', 'type'];

export const OrderByEnum = {
	ID: 'id',
	NAME: 'name',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_name',
	'invalid_type',
] as const;

export class VendorValidator extends BaseValidator<typeof validatorMessages> {
	readonly create = z.object({
		name: this.validateString(this.getMessage('invalid_name')),
		type: this.validateEnum(
			VendorTypeEnum,
			this.getMessage('invalid_type'),
		),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			name: this.validateString(this.getMessage('invalid_name'), {
				required: false,
			}),
			type: this.validateEnum(
				VendorTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
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
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' }), {
				required: false,
			}),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			type: this.validateEnum(
				VendorTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			status: this.validateEnum(
				VendorStatusEnum,
				this.getMessage('invalid_status'),
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
			VendorStatusEnum,
			this.getMessage('invalid_status'),
		),
	});
}
