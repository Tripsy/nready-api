import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { PlaceTypeEnum } from '@/features/place/place.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'place_type',
	'code',
	'alpha2_code',
	'parent_id',
	'contents',
];

export const OrderByEnum = {
	ID: 'id',
} as const;

/**
 * Width of the `code` column (`varchar(3)`). Postgres rejects a longer value outright, so the
 * cap belongs here - a value that reaches the write fails as a 500 rather than a field error.
 */
const CODE_MAX_CHARS = 3;

/**
 * Width of `alpha2_code` (`varchar(2)`), and the shape of an ISO 3166-1 alpha-2 code - the two
 * happen to be the same number, which is why the column is that width.
 */
const ALPHA2_CODE_CHARS = 2;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_name',
	'invalid_place_type',
	'invalid_type_label',
	'invalid_code',
	'invalid_parent_id',
	'required_parent_id',
] as const;

export class PlaceValidator extends BaseValidator<typeof validatorMessages> {
	readonly contentsSchema = z.object({
		language: this.validateLanguage(),
		name: this.validateString(this.getMessage('invalid_name')),
		type_label: this.validateString(this.getMessage('invalid_type_label')),
	});

	readonly create = z.object({
		place_type: this.validateEnum(
			PlaceTypeEnum,
			this.getMessage('invalid_place_type'),
		),
		code: this.validateString(this.getMessage('invalid_code'), {
			required: false,
			maxChars: CODE_MAX_CHARS,
		}),
		alpha2_code: this.validateString(this.getMessage('invalid_code'), {
			required: false,
			maxChars: ALPHA2_CODE_CHARS,
		}),
		parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
			required: false,
		}),
		contents: this.contentsSchema
			.array()
			.min(1, this.getMessage('invalid_contents'))
			.refine(
				(contents) => {
					const languages = contents.map((c) => c.language);

					return new Set(languages).size === languages.length;
				},
				{ message: this.getMessage('duplicate_contents') },
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
			place_type: this.validateEnum(
				PlaceTypeEnum,
				this.getMessage('invalid_place_type'),
				{ required: false },
			),
			code: this.validateString(this.getMessage('invalid_code'), {
				required: false,
				maxChars: CODE_MAX_CHARS,
			}),
			alpha2_code: this.validateString(this.getMessage('invalid_code'), {
				required: false,
				maxChars: ALPHA2_CODE_CHARS,
			}),
			parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
				required: false,
			}),
			contents: this.contentsSchema
				.array()
				.refine(
					(contents) => {
						const languages = contents.map((c) => c.language);

						return new Set(languages).size === languages.length;
					},
					{ message: this.getMessage('duplicate_contents') },
				)
				.optional(),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		})
		.superRefine((data, ctx) => {
			if (
				data.place_type &&
				(data.place_type === PlaceTypeEnum.REGION ||
					data.place_type === PlaceTypeEnum.CITY) &&
				!data.parent_id
			) {
				ctx.addIssue({
					path: ['parent_id'],
					message: this.getMessage('required_parent_id'),
					code: 'custom',
				});
			}
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
			place_type: this.validateEnum(
				PlaceTypeEnum,
				this.getMessage('invalid_place_type'),
				{ required: false },
			),
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
	 * The storefront city search. Only a term: the place type is fixed to city, the page size is
	 * the controller's, and the language is the request's - none of them is the shopper's to widen.
	 */
	readonly publicFind = z.object({
		term: this.validateString(this.getMessage('invalid_string'), {
			minChars: Configuration.get('filter.termMinLength'),
		}),
	});
}
