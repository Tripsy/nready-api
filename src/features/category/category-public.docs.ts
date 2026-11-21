import { Configuration } from '@/config/settings.config';
import {
	CategoryStatusEnum,
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import { categoryInputPayloads } from '@/features/category/category.mock';
import { OrderByEnum } from '@/features/category/category.validator';
import type { categoryPublicController } from '@/features/category/category-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * The visitor-facing half of the category feature, mounted under `/public/categories` by
 * `category-public.routes.ts`. Documented separately from `category.docs.ts` because it is a
 * route module of its own - a different base path, a different controller, and no bearer
 * token - even though both describe the same entity.
 */
export const docs: Record<
	keyof typeof categoryPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: 'List the published categories of one type',
		success: {
			status: 200,
			description: 'Category list',
			dataSample: {
				entries: [
					{
						id: 1,
						type: CategoryTypeEnum.PRODUCT,
						sort_order: 0,
						contents: [
							{
								language: 'en',
								label: 'Technology',
								slug: 'technology',
								description: null,
								meta: null,
							},
						],
						parent: { id: null },
					},
				],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.SORT_ORDER,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						language: 'en',
						type: CategoryTypeEnum.PRODUCT,
					},
				},
			},
		},
		withErrors: [422],
		request: {
			notes: `Only ${CategoryStatusEnum.ACTIVE} categories are addressable - status and deleted rows are pinned by the service, not filterable. Each row carries its contents in one language and its parent id alone, which is enough to nest the rows returned. There is no term filter here`,
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
					default: OrderByEnum.SORT_ORDER,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
						condition:
							'falls back to the request language; a category with no content in it is absent',
					},
					type: {
						type: 'enum',
						required: false,
						values: Object.values(CategoryTypeEnum),
						default: CategoryTypeEnum.PRODUCT,
					},
					parent_id: {
						type: 'string',
						required: false,
						condition:
							'addresses one sibling group; is_root wins when both are sent',
					},
					is_root: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'the categories with no parent - a null parent cannot be expressed through parent_id',
					},
				},
			},
			sample: categoryInputPayloads.publicFind,
		},
	}),
};
