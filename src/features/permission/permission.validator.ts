import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	ENTITY: 'entity',
	OPERATION: 'operation',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_entity',
	'invalid_operation',
] as const;

export class PermissionValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly create = z.object({
		entity: this.validateString(this.getMessage('invalid_entity')),
		operation: this.validateString(this.getMessage('invalid_operation')),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		entity: this.validateString(this.getMessage('invalid_entity')),
		operation: this.validateString(this.getMessage('invalid_operation')),
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
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});
}
