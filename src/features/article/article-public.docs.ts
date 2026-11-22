import { Configuration } from '@/config/settings.config';
import { ArticleFeaturedStatusEnum } from '@/features/article/article.entity';
import {
	articleInputPayloads,
	getArticleEntityMock,
} from '@/features/article/article.mock';
import { OrderByEnum } from '@/features/article/article.validator';
import type { articlePublicController } from '@/features/article/article-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * The visitor-facing half of the article feature, mounted under `/public/articles` by
 * `article-public.routes.ts`. Documented separately from `article.docs.ts` because it is a
 * route module of its own - a different base path, a different controller, and no bearer
 * token - even though both describe the same entity.
 */
const entitySample = getArticleEntityMock() as unknown as Record<
	string,
	unknown
>;

const displayWindowNote =
	'Only the display window is addressable: an article that is not published, or restricted and not listed, is absent whatever the filter';

export const docs: Record<
	keyof typeof articlePublicController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Read one published article by slug',
		success: {
			status: 200,
			description: 'Article details',
			dataSample: entitySample,
		},
		withErrors: [404, 422],
		request: {
			notes: `${displayWindowNote}. A restricted article guarded by a password answers 404 until the right one is sent`,
			params: {
				slug: {
					type: 'string',
					required: true,
					condition: 'trimmed and lower-cased before lookup',
				},
			},
			query: {
				language: {
					type: 'enum',
					required: false,
					values: Configuration.get('language.supported'),
					condition:
						'falls back to the request language; decides which translation is returned',
				},
				password: {
					type: 'string',
					required: false,
					condition: 'for a restricted article that asks for one',
				},
			},
			sample: articleInputPayloads.publicRead,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'List published articles',
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
					order_by: 'publish_at',
					direction: 'DESC',
					limit: 5,
					page: 1,
					filter: {
						term: 'article',
						language: 'en',
					},
				},
			},
		},
		withErrors: [422],
		request: {
			notes: `${displayWindowNote}. The filter set is deliberately narrower than the dashboard listing - no status, visibility, author or is_deleted - so nothing here can widen that window`,
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
					default: OrderByEnum.PUBLISH_AT,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: {
						type: 'string',
						required: false,
						condition:
							'resolves a permalink that cannot carry the slug',
					},
					term: {
						type: 'string',
						required: false,
						condition: `at least ${Configuration.get('filter.termMinLength')} characters`,
					},
					featured_status: {
						type: 'enum',
						required: false,
						values: Object.values(ArticleFeaturedStatusEnum),
					},
					category_id: { type: 'string', required: false },
					tag_id: {
						type: 'array',
						required: false,
						format: 'number[]',
						condition:
							'repeatable; a single value is accepted unwrapped',
					},
					exclude_id: {
						type: 'string',
						required: false,
						condition:
							'drops one article, so a sidebar cannot recommend the page it sits on',
					},
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
					},
				},
			},
			sample: articleInputPayloads.publicFind,
		},
	}),
};
