import type CategoryEntity from '@/features/category/category.entity';
import {
	CategoryStatusEnum,
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import {
	CategoryValidator,
	OrderByEnum,
} from '@/features/category/category.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const categoryValidator = new CategoryValidator('category');

export function getCategoryEntityMock(): CategoryEntity {
	return {
		created_at: createPastDate(86400),
		deleted_at: null,
		details: undefined,
		parent: null,
		sort_order: 0,
		status: CategoryStatusEnum.ACTIVE,
		type: CategoryTypeEnum.ARTICLE,
		updated_at: null,
		id: mockId(1),
	};
}

export const categoryInputPayloads = {
	create: {
		type: CategoryTypeEnum.ARTICLE,
		parent_id: mockId(1),
		contents: [
			{
				language: 'en',
				label: 'Technology',
				slug: 'Technology ',
				meta: {
					title: 'Technology Articles',
					description: 'All technology related content',
					keywords: 'technology',
				},
				description: 'Tech related articles and news',
			},
			{
				language: 'fr',
				label: 'Technologies',
				slug: 'technologies',
				meta: {
					title: 'Articles Technologies',
					description: 'Contenu lié à la technologie',
					keywords: 'technology',
				},
				description: 'Tech related articles and news',
			},
		],
	},
	read: {
		with_ancestors: false,
		with_children: false,
	},
	update: {
		id: mockId(1),
		parent_id: mockId(3),
		contents: [
			{
				language: 'en',
				label: 'Science',
				slug: 'science',
				meta: {
					title: 'Science',
					description: 'Scientific content',
					keywords: 'science',
				},
				description: 'Tech related articles and news',
			},
		],
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			language: 'en',
			type: CategoryTypeEnum.ARTICLE,
			status: CategoryStatusEnum.ACTIVE,
			term: 'tech',
			is_deleted: false,
		},
	},
	// No status and no is_deleted: the public schema has neither, and the service pins both.
	publicFind: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.SORT_ORDER,
		direction: OrderDirectionEnum.DESC,
		filter: {
			language: 'en',
			type: CategoryTypeEnum.PRODUCT,
		},
	},
	statusUpdate: {
		force: false,
	},
	orderUpdate: {
		type: CategoryTypeEnum.ARTICLE,
		parent_id: mockId(1),
		positions: [mockId(3), mockId(2)],
	},
};

export const categoryOutputPayloads = {
	create: categoryValidator.create.parse(categoryInputPayloads.create),
	update: categoryValidator.update.parse(categoryInputPayloads.update),
	find: categoryValidator.find.parse(categoryInputPayloads.find),
	publicFind: categoryValidator.publicFind.parse(
		categoryInputPayloads.publicFind,
	),
};
