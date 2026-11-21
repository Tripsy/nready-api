import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'name',
	'website',
	'phone',
	'email',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	NAME: 'name',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_name',
	'invalid_website',
	'invalid_phone',
	'invalid_email',
] as const;

export class CarrierValidator extends BaseValidator<typeof validatorMessages> {
	readonly create = z.object({
		name: this.validateString(this.getMessage('invalid_name')),
		website: this.validateString(this.getMessage('invalid_website'), {
			required: false,
		}),
		phone: this.validatePhone(this.getMessage('invalid_phone'), {
			required: false,
		}),
		email: this.validateEmail(this.getMessage('invalid_email'), {
			required: false,
		}),
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
			name: this.validateString(this.getMessage('invalid_name'), {
				required: false,
			}),
			website: this.validateString(this.getMessage('invalid_website'), {
				required: false,
			}),
			phone: this.validatePhone(this.getMessage('invalid_phone'), {
				required: false,
			}),
			email: this.validateEmail(this.getMessage('invalid_email'), {
				required: false,
			}),
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
