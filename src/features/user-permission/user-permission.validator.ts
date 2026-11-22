import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	PERMISSION_ID: 'permission_id',
	ENTITY: 'permission.entity',
	OPERATION: 'permission.operation',
} as const;

const validatorMessages = [...sharedValidatorMessages] as const;

export class UserPermissionValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly create = z.object({
		user_id: this.validateId(
			this.getMessage('invalid_id', { name: 'user_id' }),
		),
		permission_ids: z
			.array(
				this.validateId(
					this.getMessage('invalid_ids', {
						name: 'ids',
					}),
				),
			)
			.min(1, {
				message: this.getMessage('array_min', {
					name: 'permission_ids',
					length: '1',
				}),
			}),
	});

	readonly delete = z.object({
		user_id: this.validateId(
			this.getMessage('invalid_id', { name: 'user_id' }),
		),
		permission_id: this.validateId(
			this.getMessage('invalid_id', { name: 'permission_id' }),
		),
	});

	/** The same pair `delete` takes, so a caller revokes and restores by the same address. */
	readonly restore = z.object({
		user_id: this.validateId(
			this.getMessage('invalid_id', { name: 'user_id' }),
		),
		permission_id: this.validateId(
			this.getMessage('invalid_id', { name: 'permission_id' }),
		),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			entity: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			operation: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},

		querySchema: {
			user_id: this.validateId(
				this.getMessage('invalid_id', { name: 'user_id' }),
			),
		},
	});
}
