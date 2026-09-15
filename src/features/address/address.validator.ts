import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = ['city_id', 'details', 'postal_code'];

export const OrderByEnum = {
	ID: 'id',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_city_id',
	'invalid_details',
	'invalid_postal_code',
] as const;

export class AddressValidator extends BaseValidator<typeof validatorMessages> {
	readonly create = z.object({
		city_id: this.validateId(this.getMessage('invalid_city_id'), {
			required: false,
		}),
		details: this.validateString(this.getMessage('invalid_details')),
		postal_code: this.validatePostalCode(
			this.getMessage('invalid_postal_code'),
			{ required: false },
		),
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
			city_id: this.validateId(this.getMessage('invalid_city_id'), {
				required: false,
			}),
			details: this.validateString(this.getMessage('invalid_details'), {
				required: false,
			}),
			postal_code: this.validatePostalCode(
				this.getMessage('invalid_postal_code'),
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
			id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});

	/**
	 * The storefront address search. Only a term: the page size is the controller's and the
	 * language the request's, and deleted rows are never offered.
	 */
	readonly publicFind = z.object({
		term: this.validateString(this.getMessage('invalid_string'), {
			minChars: Configuration.get('filter.termMinLength'),
		}),
	});
}
