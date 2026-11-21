import { Configuration } from '@/config/settings.config';
import type { articleController } from '@/features/article/article.controller';
import {
	ArticleFeaturedStatusEnum,
	ArticleLayoutEnum,
	ArticleSourceModeEnum,
	ArticleStatusEnum,
	ArticleVisibilityEnum,
	STATUS_TRANSITIONS,
} from '@/features/article/article.entity';
import {
	articleInputPayloads,
	getArticleEntityMock,
} from '@/features/article/article.mock';
import { OrderByEnum } from '@/features/article/article.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getArticleEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Rendered as `pending -> rejected | scheduled | published`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

const contentsFormat =
	'[{ language: string; slug: string; title: string; brief?: string; content: string; meta?: { title?: string; description?: string; keywords?: string } }]';

/** Shared by `create` and `update`; only `required` differs between the two. */
function manageBody(required: boolean) {
	return {
		layout: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ArticleLayoutEnum),
			default: ArticleLayoutEnum.DEFAULT,
		},
		publish_at: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
			condition: 'releases a scheduled article on the day given',
		},
		archive_at: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
			condition: 'must fall after publish_at',
		},
		featured_status: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ArticleFeaturedStatusEnum),
		},
		featured_order: { type: 'number' as const, required: false },
		featured_expire_at: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
			condition:
				'drops the article out of its featured group on that day',
		},
		visibility: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ArticleVisibilityEnum),
			default: ArticleVisibilityEnum.PUBLIC,
		},
		visibility_rule: {
			type: 'object' as const,
			required: false,
			condition: 'only when visibility is restricted',
		},
		public_at: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
		},
		source_mode: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ArticleSourceModeEnum),
			default: ArticleSourceModeEnum.INPUT,
		},
		source: {
			type: 'object' as const,
			required: false,
			condition: 'only when source_mode is parsed',
		},
		settings: {
			type: 'object' as const,
			required: false,
			format: '{ allow_rating?: boolean; allow_comments?: boolean; allow_complaints?: boolean }',
		},
		contents: {
			type: 'array' as const,
			required,
			format: contentsFormat,
			condition: 'one entry per language; slug must be unique',
		},
		categories: {
			type: 'array' as const,
			required: false,
			format: 'number[]',
		},
		tags: { type: 'array' as const, required: false, format: 'number[]' },
	};
}

export const docs: Record<
	keyof typeof articleController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new article',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Article created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: 'An article starts as a draft; use the status route to move it on. At least one content entry is required',
			body: manageBody(true),
			sample: articleInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get article details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update article',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			notes: 'Provide at least one body parameter. A contents array replaces the stored entries for the languages it carries',
			body: manageBody(false),
			sample: articleInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete article',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore article',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article restored with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Move an article to another status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article status updated with success',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote}`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(ArticleStatusEnum),
				},
			},
		},
	}),
	orderUpdate: helperApiInputDocumentation({
		description: 'Reorder the articles inside one featured group',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article order updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: 'The group is a scope, not a column: `category` needs category_id and `section` must omit it. `positions` must list the whole group, in the order wanted',
			params: {
				featured_status: {
					type: 'enum',
					required: true,
					values: Object.values(ArticleFeaturedStatusEnum),
				},
			},
			body: {
				category_id: {
					type: 'string',
					required: false,
					condition: 'required when featured_status is category',
				},
				positions: {
					type: 'array',
					required: true,
					format: 'number[]',
					condition: 'at least two ids, covering the whole group',
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get articles',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Article list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: 'id',
					direction: 'DESC',
					limit: 5,
					page: 1,
					filter: {
						term: 'article',
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'The dashboard listing: it can address every article, whatever its status',
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
						condition: `at least ${Configuration.get('filter.termMinLength')} characters`,
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(ArticleStatusEnum),
					},
					visibility: {
						type: 'enum',
						required: false,
						values: Object.values(ArticleVisibilityEnum),
					},
					featured_status: {
						type: 'enum',
						required: false,
						values: Object.values(ArticleFeaturedStatusEnum),
					},
					source_mode: {
						type: 'enum',
						required: false,
						values: Object.values(ArticleSourceModeEnum),
					},
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
						condition:
							'also decides which translation the rows carry',
					},
					author_id: { type: 'string', required: false },
					category_id: { type: 'string', required: false },
					tag_id: { type: 'string', required: false },
					is_published: {
						type: 'boolean',
						required: false,
						default: false,
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: articleInputPayloads.find,
		},
	}),
};
