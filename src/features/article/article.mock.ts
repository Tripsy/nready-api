import type ArticleEntity from '@/features/article/article.entity';
import {
	ArticleFeaturedStatusEnum,
	ArticleLayoutEnum,
	ArticleSourceModeEnum,
	ArticleStatusEnum,
	ArticleVisibilityEnum,
} from '@/features/article/article.entity';
import {
	ArticleValidator,
	OrderByEnum,
} from '@/features/article/article.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const articleValidator = new ArticleValidator('article');

export function getArticleEntityMock(): ArticleEntity {
	return {
		id: mockId(1),
		status: ArticleStatusEnum.DRAFT,
		layout: ArticleLayoutEnum.DEFAULT,
		details: null,
		publish_at: null,
		archive_at: null,
		featured_status: null,
		featured_order: 0,
		featured_expire_at: null,
		visibility: ArticleVisibilityEnum.PUBLIC,
		public_at: null,
		source_mode: ArticleSourceModeEnum.INPUT,
		source: null,
		author_id: null,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		contents: [],
		tags: [],
		categories: [],
	};
}

export const articleInputPayloads = {
	// Every optional key is spelled out rather than omitted: the shared controller-test
	// builders type the payload against the *parsed* shape, where an optional field is a
	// present key holding `undefined`
	create: {
		layout: ArticleLayoutEnum.DEFAULT,
		publish_at: undefined,
		archive_at: undefined,
		featured_status: undefined,
		featured_order: undefined,
		featured_expire_at: undefined,
		visibility: ArticleVisibilityEnum.PUBLIC,
		public_at: undefined,
		source_mode: ArticleSourceModeEnum.INPUT,
		source: undefined,
		author_id: undefined,
		contents: [
			{
				language: 'en',
				slug: 'first-article',
				title: 'First article',
				brief: 'A short introduction',
				content: 'The body of the first article.',
				meta: {
					title: 'First article',
					description: 'A short introduction',
					keywords: 'article',
				},
			},
		],
		categories: [mockId(1)],
		tags: [mockId(1), mockId(2)],
	},
	update: {
		id: mockId(1),
		layout: undefined,
		publish_at: undefined,
		archive_at: undefined,
		featured_status: ArticleFeaturedStatusEnum.SECTION,
		featured_order: 10,
		featured_expire_at: undefined,
		visibility: undefined,
		public_at: undefined,
		source: undefined,
		author_id: undefined,
		categories: undefined,
		contents: [
			{
				language: 'en',
				slug: 'first-article',
				title: 'First article, revised',
				brief: 'A short introduction',
				content: 'The revised body of the first article.',
				meta: {
					title: 'First article',
					description: 'A short introduction',
					keywords: 'article',
				},
			},
		],
		tags: [mockId(2)],
	},
	publicRead: {
		slug: 'first-article',
		language: 'en',
		password: undefined,
	},
	publicFind: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.PUBLISH_AT,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'article',
			language: 'en',
		},
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'article',
			status: ArticleStatusEnum.PUBLISHED,
			language: 'en',
			is_published: true,
			is_deleted: false,
		},
	},
};

export const articleOutputPayloads = {
	create: articleValidator.create.parse(articleInputPayloads.create),
	update: articleValidator.update.parse(articleInputPayloads.update),
	find: articleValidator.find.parse(articleInputPayloads.find),
};
