import { Configuration } from '@/config/settings.config';
import type { templateController } from '@/features/template/template.controller';
import { TemplateTypeEnum } from '@/features/template/template.entity';
import {
	getTemplateEntityMock,
	templateInputPayloads,
} from '@/features/template/template.mock';
import { OrderByEnum } from '@/features/template/template.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getTemplateEntityMock() as unknown as Record<
	string,
	unknown
>;

const identityNote =
	'label, language and type are unique together among the rows that are not deleted, and they are also how a template is looked up at render time - never by id';

const labelParam = {
	type: 'string' as const,
	required: true,
	condition:
		'what the render-time lookup asks for; for a page it is also the URL segment it answers on',
};

const typeParam = {
	type: 'enum' as const,
	required: true,
	values: Object.values(TemplateTypeEnum),
	condition: 'discriminates the shape of `content`',
};

const contentParam = {
	type: 'object' as const,
	required: true,
	condition:
		'email: subject, html, optional text and layout - page: title, html and optional layout. `html` is sanitised on save, so what is stored is what will be sent or served',
};

/**
 * Templates hold the content the backend would otherwise carry in code: the body of an email it
 * sends, or the body of a public page. Only the email path renders through the template engine,
 * so a `{{ placeholder }}` resolves there and is printed literally on a page.
 *
 * Every write clears two cache entries, not one - the row's own, and the label/language/type
 * lookup that a render reads. A rename clears the old lookup as well, or the previous name would
 * go on serving the previous body until its TTL.
 *
 * These are the dashboard routes, all bearer-gated. The one open route lives in
 * `template-public.docs.ts`, which serves page bodies to visitors under `/public/pages`.
 */
export const docs: Record<
	keyof typeof templateController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new template',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Template created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: `${identityNote}. A duplicate answers 409`,
			body: {
				label: labelParam,
				language: { type: 'string', required: true },
				type: typeParam,
				content: contentParam,
			},
			sample: templateInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get template details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Template details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'A deleted template is only visible to a caller holding template delete',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update template',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Template updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Provide at least one of label, language or content - \`type\` alone does not count, since it is filled in from the stored row when the body omits it. ${identityNote}, so a renamed template is re-checked against the others`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				label: { ...labelParam, required: false },
				language: { type: 'string', required: false },
				type: {
					...typeParam,
					required: false,
					condition:
						'defaults to the stored value; changing it means sending the new type’s `content` in the same request',
				},
				content: { ...contentParam, required: false },
			},
			sample: templateInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete template',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Template deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Soft delete. The label is free for reuse immediately, because the uniqueness rule ignores deleted rows',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore template',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Template restored with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Fails while another template holds the same label, language and type',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get templates',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Template list',
			dataSample: {
				entries: [entitySample],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.ASC,
					limit: 5,
					page: 1,
					filter: {
						term: 'welcome',
						language: 'en',
						type: TemplateTypeEnum.EMAIL,
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			query: {
				page: {
					type: 'number',
					required: false,
					default: 1,
				},
				limit: {
					type: 'number',
					required: false,
					default: Configuration.get('filter.limit'),
				},
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
					default: OrderByEnum.ID,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.ASC,
				},
				filter: {
					id: { type: 'string', required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the label and the stored content itself, from ${Configuration.get('filter.termMinLength')} characters - so a phrase from the body finds the template holding it`,
					},
					language: { type: 'string', required: false },
					type: {
						type: 'enum',
						required: false,
						values: Object.values(TemplateTypeEnum),
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only takes effect for a caller holding template delete',
					},
				},
			},
			sample: templateInputPayloads.find,
		},
	}),
};
