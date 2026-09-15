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
	'invalid_city_id',
	'invalid_street',
	'invalid_postal_code',
	'address_conflict',
] as const;

/** Bounds on what a shopper may type; the columns are `text`, so these are payload limits. */
const STREET_MAX_CHARS = 255;
const DETAILS_MAX_CHARS = 255;
const NOTES_MAX_CHARS = 500;

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

	/** The storefront list: one client's addresses, narrowed by type. Ownership is the controller's. */
	readonly publicFind = z.object({
		client_id: this.validateId(
			this.getMessage('invalid_client_id', { name: 'client_id' }),
		),
		type: this.validateEnum(
			ClientAddressTypeEnum,
			this.getMessage('invalid_type'),
			{ required: false },
		),
	});

	/**
	 * A shopper filing an address under one of their clients - the storefront twin of the
	 * dashboard's "Add client address". Either branch, never both:
	 *
	 * - **`address_id`**: an address picked from `GET /public/addresses`, linked as the dashboard
	 *   links one. The row may already be filed against other clients.
	 * - **`city_id` + `street`** (+ `postal_code`): the search found nothing, so a new `address`
	 *   row is written and linked in one step - what the dashboard does in a second window.
	 *
	 * `street` is `address.details`; `details` stays the client address's own flat/floor note, so
	 * the two layers keep the names the dashboard already reads them by.
	 *
	 * There is no public update: a filed address is added or removed, never rewritten - editing
	 * the linked row would move every other client pointing at it.
	 */
	readonly publicCreate = z
		.object({
			client_id: this.validateId(
				this.getMessage('invalid_client_id', { name: 'client_id' }),
			),
			type: this.validateEnum(
				ClientAddressTypeEnum,
				this.getMessage('invalid_type'),
			),
			address_id: this.validateId(
				this.getMessage('invalid_address_id', { name: 'address_id' }),
				{ required: false },
			),
			city_id: this.validateId(this.getMessage('invalid_city_id'), {
				required: false,
			}),
			street: this.validateString(this.getMessage('invalid_street'), {
				required: false,
				maxChars: STREET_MAX_CHARS,
			}),
			postal_code: this.validatePostalCode(
				this.getMessage('invalid_postal_code'),
				{ required: false },
			),
			details: this.validateString(this.getMessage('invalid_details'), {
				required: false,
				maxChars: DETAILS_MAX_CHARS,
			}),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
				maxChars: NOTES_MAX_CHARS,
			}),
		})
		.superRefine((data, ctx) => {
			const hasNewAddress =
				data.city_id !== undefined ||
				!!data.street ||
				!!data.postal_code;

			if (data.address_id) {
				if (hasNewAddress) {
					ctx.addIssue({
						path: ['address_id'],
						message: this.getMessage('address_conflict'),
						code: 'custom',
					});
				}

				return;
			}

			if (!data.city_id) {
				ctx.addIssue({
					path: ['city_id'],
					message: this.getMessage('invalid_city_id'),
					code: 'custom',
				});
			}

			if (!data.street) {
				ctx.addIssue({
					path: ['street'],
					message: this.getMessage('invalid_street'),
					code: 'custom',
				});
			}
		});
}
