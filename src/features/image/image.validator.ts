import { z } from 'zod';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import {
	ImageMimeEnum,
	ImageSectionEnum,
	ImageStatusEnum,
	ImageStorageEnum,
	ImageTypeEnum,
} from '@/features/image/image.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = ['contents'];

export const OrderByEnum = {
	ID: 'id',
	SORT_ORDER: 'sort_order',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_image_type',
	'invalid_storage',
	'invalid_path',
	'invalid_width',
	'invalid_height',
	'invalid_size',
	'invalid_mime',
	'invalid_alt',
	'invalid_title',
	'invalid_description',
	'invalid_sort_order',
	'invalid_entity_id',
	'invalid_section',
] as const;

export class ImageValidator extends BaseValidator<typeof validatorMessages> {
	protected validateProperties(
		message = {
			invalid_width: 'Invalid width',
			invalid_height: 'Invalid height',
			invalid_size: 'Invalid file size',
			invalid_mime: 'Invalid mime type',
		},
	) {
		return z.preprocess(
			(val) => val ?? {},
			z.object({
				width: this.validateNumber(message.invalid_width, {
					required: false,
				}),
				height: this.validateNumber(message.invalid_width, {
					required: false,
				}),
				size: this.validateNumber(message.invalid_width),
				mime: this.validateEnum(ImageMimeEnum, message.invalid_mime),
			}),
		);
	}

	readonly contentsSchema = z.object({
		language: this.validateLanguage(this.getMessage('invalid_language')),
		title: this.validateString(this.getMessage('invalid_title'), {
			required: false,
		}),
		description: this.validateString(
			this.getMessage('invalid_description'),
			{
				required: false,
			},
		),
	});

	readonly create = z.object({
		section: this.validateEnum(
			ImageSectionEnum,
			this.getMessage('invalid_section'),
		),
		entity_id: this.validateId(this.getMessage('invalid_entity_id')),
		image_type: this.validateEnum(
			ImageTypeEnum,
			this.getMessage('invalid_image_type'),
		),
		storage: this.validateEnum(
			ImageStorageEnum,
			this.getMessage('invalid_storage'),
		),
		path: this.validateString(this.getMessage('invalid_path')),
		properties: this.validateProperties({
			invalid_width: this.getMessage('invalid_width'),
			invalid_height: this.getMessage('invalid_height'),
			invalid_size: this.getMessage('invalid_size'),
			invalid_mime: this.getMessage('invalid_mime'),
		}),
		sort_order: this.validateNumber(this.getMessage('invalid_sort_order'), {
			required: false,
		}),
		contents: this.contentsSchema
			.array()
			.min(1, { message: this.getMessage('invalid_contents') })
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
			contents: this.contentsSchema
				.array()
				.min(1, { message: this.getMessage('invalid_contents') })
				.refine(
					(contents) => {
						const languages = contents.map((c) => c.language);

						return new Set(languages).size === languages.length;
					},
					{ message: this.getMessage('duplicate_contents') },
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
			section: this.validateEnum(
				ImageSectionEnum,
				this.getMessage('invalid_section'),
				{ required: false },
			),
			entity_id: this.validateId(this.getMessage('invalid_entity_id'), {
				required: false,
			}),
			image_type: this.validateEnum(
				ImageTypeEnum,
				this.getMessage('invalid_image_type'),
				{ required: false },
			),
			status: this.validateEnum(
				ImageStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
		},
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			ImageStatusEnum,
			this.getMessage('invalid_status'),
		),
	});

	readonly orderUpdate = z.object({
		section: this.validateEnum(
			ImageSectionEnum,
			this.getMessage('invalid_section'),
		),
		entity_id: this.validateId(this.getMessage('invalid_entity_id')),
		positions: z
			.array(
				z.object({
					id: this.validateId(
						this.getMessage('invalid_id', { name: 'id' }),
					),
					sort_order: this.validateNumber(
						this.getMessage('invalid_sort_order'),
					),
				}),
			)
			.min(2, {
				message: lang('shared.validation.array_min', {
					length: '2',
				}),
			})
			.refine(
				(positions) => {
					const ids = positions.map((p) => p.id);

					return new Set(ids).size === ids.length;
				},
				{ message: this.getMessage('duplicate_position_ids') },
			),
	});
}
