import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { TemplateTypeEnum } from '@/features/template/template.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { safeHtml } from '@/helpers/string.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'label',
	'language',
	'type',
	'content',
];

/*
 * `type` discriminates the update union, so the controller fills it in from the stored row
 * whenever the body omits it - by the time the schema runs it is always present, and counting
 * it would defeat the empty-update check exactly as `id` would. It stays in
 * `paramsUpdateList` because it is genuinely updatable and the message should say so.
 *
 * The cost is that an update carrying *only* `type` is rejected. That is not a real loss:
 * switching a template between email and page means sending the matching `content` too, and
 * that is counted.
 */
const paramsUpdateCheckList = paramsUpdateList.filter(
	(param) => param !== 'type',
);

export const OrderByEnum = {
	ID: 'id',
	LABEL: 'label',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_label',
	'invalid_type',
	'invalid_email_subject',
	'invalid_email_text',
	'invalid_email_html',
	'invalid_email_layout',
	'invalid_page_title',
	'invalid_page_html',
	'invalid_page_layout',
] as const;

export class TemplateValidator extends BaseValidator<typeof validatorMessages> {
	readonly baseCreateSchema = {
		label: this.validateString(this.getMessage('invalid_label')),
		language: this.validateLanguage(this.getMessage('invalid_language')),
	};

	readonly baseUpdateSchema = {
		label: this.validateString(this.getMessage('invalid_label'), {
			required: false,
		}),
		language: this.validateLanguage(this.getMessage('invalid_language'), {
			required: false,
		}),
	};

	readonly create = z.discriminatedUnion('type', [
		// Email schema
		z
			.object({
				type: z.literal(TemplateTypeEnum.EMAIL),
				content: z.object({
					subject: this.validateString(
						this.getMessage('invalid_email_subject'),
					),
					text: this.validateString(
						this.getMessage('invalid_email_text'),
						{ required: false },
					),
					html: this.validateString(
						this.getMessage('invalid_email_html'),
					).transform((val) => safeHtml(val)),
					layout: this.validateString(
						this.getMessage('invalid_email_layout'),
						{ required: false },
					).default('default'),
				}),
			})
			.extend(this.baseCreateSchema),

		// Page schema
		z
			.object({
				type: z.literal(TemplateTypeEnum.PAGE),
				content: z.object({
					title: this.validateString(
						this.getMessage('invalid_page_title'),
					),
					html: this.validateString(
						this.getMessage('invalid_page_html'),
					).transform((val) => safeHtml(val)),
					layout: this.validateString(
						this.getMessage('invalid_page_layout'),
						{ required: false },
					).default('default'),
				}),
			})
			.extend(this.baseCreateSchema),
	]);

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly publicRead = z.object({
		label: this.validateString(this.getMessage('invalid_label')),
	});

	readonly update = z
		.discriminatedUnion('type', [
			// Email schema
			z
				.object({
					id: this.validateId(
						this.getMessage('invalid_id', { name: 'id' }),
					),
					type: z.literal(TemplateTypeEnum.EMAIL),
					content: z
						.object({
							subject: this.validateString(
								this.getMessage('invalid_email_subject'),
								{ required: false },
							),
							text: this.validateString(
								this.getMessage('invalid_email_text'),
								{ required: false },
							),
							html: this.validateString(
								this.getMessage('invalid_email_html'),
								{ required: false },
							).transform((val) =>
								val ? safeHtml(val) : undefined,
							),
							layout: this.validateString(
								this.getMessage('invalid_email_layout'),
								{ required: false },
							).default('default'),
						})
						.optional(),
				})
				.extend(this.baseUpdateSchema),

			// Page schema
			z
				.object({
					id: this.validateId(
						this.getMessage('invalid_id', { name: 'id' }),
					),
					type: z.literal(TemplateTypeEnum.PAGE),
					content: z
						.object({
							title: this.validateString(
								this.getMessage('invalid_page_title'),
								{ required: false },
							),
							html: this.validateString(
								this.getMessage('invalid_page_html'),
								{ required: false },
							).transform((val) =>
								val ? safeHtml(val) : undefined,
							),
							layout: this.validateString(
								this.getMessage('invalid_page_layout'),
								{ required: false },
							).default('default'),
						})
						.optional(),
				})
				.extend(this.baseUpdateSchema),
		])
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateCheckList), {
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
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			type: this.validateEnum(
				TemplateTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});
}
