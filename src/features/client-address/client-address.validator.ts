import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { ClientAddressTypeEnum } from '@/features/client-address/client-address.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * `client_id` is absent on purpose: an address is filed against one client for its whole life, and
 * moving it would silently change where another client's orders are billed or delivered.
 */
export const paramsUpdateList: string[] = [
	'type',
	'address_id',
	'details',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	TYPE: 'type',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_client_id',
	'invalid_address_id',
	'invalid_type',
	'invalid_details',
] as const;

export class ClientAddressValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly create = z.object({
		client_id: this.validateId(
			this.getMessage('invalid_client_id', { name: 'client_id' }),
		),
		address_id: this.validateId(
			this.getMessage('invalid_address_id', { name: 'address_id' }),
		),
		type: this.validateEnum(
			ClientAddressTypeEnum,
			this.getMessage('invalid_type'),
		),
		details: this.validateString(this.getMessage('invalid_details'), {
			required: false,
		}),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		language: this.validateLanguage(this.getMessage('invalid_language'), {
			required: false,
		}),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			type: this.validateEnum(
				ClientAddressTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			address_id: this.validateId(
				this.getMessage('invalid_address_id', { name: 'address_id' }),
				{ required: false },
			),
			details: this.validateString(this.getMessage('invalid_details'), {
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

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

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
			client_id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			address_id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			type: this.validateEnum(
				ClientAddressTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
		},
	});
}
