import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { BrandStatusEnum, BrandTypeEnum } from '@/features/brand/brand.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'name',
	'slug',
	'brand_type',
	'contents',
];

export const OrderByEnum = {
	ID: 'id',
	NAME: 'name',
	SORT_ORDER: 'sort_order',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_description',
	'invalid_name',
	'invalid_slug',
	'invalid_brand_type',
] as const;

export class BrandValidator extends BaseValidator<typeof validatorMessages> {
	readonly contentsSchema = z.object({
		language: this.validateLanguage(this.getMessage('invalid_language')),
		description: this.validateString(
			this.getMessage('invalid_description'),
			{ required: false },
		),
		meta: this.validateMeta({
			invalid_meta_title: this.getMessage('invalid_meta_title'),
			invalid_meta_description: this.getMessage(
				'invalid_meta_description',
			),
			invalid_meta_keywords: this.getMessage('invalid_meta_keywords'),
		}),
	});

	readonly create = z.object({
		name: this.validateString(this.getMessage('invalid_name')),
		slug: this.validateString(this.getMessage('invalid_slug')).transform(
			(val) => val.trim().toLowerCase(),
		),
		brand_type: this.validateEnum(
			BrandTypeEnum,
			this.getMessage('invalid_brand_type'),
		),
		/*
		 * No minimum, unlike the entities whose content row carries their wording: a brand
		 * keeps its `name` and `slug` on the row itself, and every column of `brand_content` is
		 * nullable - so demanding one would only force an editor to invent a description to
		 * satisfy a row that may legitimately hold nothing. `update` never asked for one
		 * either, and `saveContent` already returns early on an empty list.
		 */
		contents: this.contentsSchema.array().refine(
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
			name: this.validateString(this.getMessage('invalid_name'), {
				required: false,
			}),
			slug: this.validateString(this.getMessage('invalid_slug'), {
				required: false,
			}).transform((val) => val?.trim().toLowerCase()),
			brand_type: this.validateEnum(
				BrandTypeEnum,
				this.getMessage('invalid_brand_type'),
				{ required: false },
			),
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
			/*
			 * A list rather than a scalar, so a caller holding several ids - the discount view
			 * naming its targets - resolves them all in one request. A single id still arrives
			 * as one.
			 */
			id: this.validateIdFilter(
				this.getMessage('invalid_ids', { name: 'id' }),
				{
					required: false,
				},
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			brand_type: this.validateEnum(
				BrandTypeEnum,
				this.getMessage('invalid_brand_type'),
				{ required: false },
			),
			status: this.validateEnum(
				BrandStatusEnum,
				this.getMessage('invalid_status'),
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

	readonly publicFind = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.SORT_ORDER,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			brand_type: this.validateEnum(
				BrandTypeEnum,
				this.getMessage('invalid_brand_type'),
				{ required: false },
			).default(BrandTypeEnum.PRODUCT),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
		},
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			BrandStatusEnum,
			this.getMessage('invalid_status'),
		),
	});

	readonly orderUpdate = z.object({
		brand_type: this.validateEnum(
			BrandTypeEnum,
			this.getMessage('invalid_brand_type'),
		),
		positions: z
			.array(this.validateId(this.getMessage('invalid_number')))
			.min(2, {
				message: this.getMessage('array_min', {
					length: '2',
				}),
			}),
	});
}
