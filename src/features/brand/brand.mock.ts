import type BrandEntity from '@/features/brand/brand.entity';
import { BrandStatusEnum, BrandTypeEnum } from '@/features/brand/brand.entity';
import { BrandValidator, OrderByEnum } from '@/features/brand/brand.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const brandValidator = new BrandValidator('brand');

export function getBrandEntityMock(): BrandEntity {
	return {
		id: mockId(1),
		name: 'Pepsi',
		slug: 'pepsi',
		brand_type: BrandTypeEnum.PRODUCT,
		status: BrandStatusEnum.ACTIVE,
		sort_order: 0,
		details: null,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		contents: [],
	};
}

export const brandInputPayloads = {
	create: {
		name: 'Pepsi',
		slug: 'pepsi',
		brand_type: BrandTypeEnum.PRODUCT,
		contents: [
			{
				language: 'en',
				description: 'Juicy juice',
				meta: {
					title: 'Pepsi juice',
					description: 'Is all about Pepsi',
					keywords: 'juice',
				},
			},
		],
	},
	update: {
		id: mockId(1),
		name: 'Pepsi',
		slug: 'pepsi',
		brand_type: BrandTypeEnum.PRODUCT,
		contents: [
			{
				language: 'en',
				description: 'Juicy juice',
				meta: {
					title: 'Pepsi juice',
					description: 'Is all about Pepsi',
					keywords: 'juice',
				},
			},
		],
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'pepsi',
			brand_type: BrandTypeEnum.PRODUCT,
			status: BrandStatusEnum.ACTIVE,
			language: 'en',
			is_deleted: false,
		},
	},
	publicFind: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.SORT_ORDER,
		direction: OrderDirectionEnum.ASC,
		filter: {
			language: 'en',
			brand_type: BrandTypeEnum.PRODUCT,
		},
	},
	orderUpdate: {
		positions: [mockId(1), mockId(2)],
	},
};

export const brandOutputPayloads = {
	create: brandValidator.create.parse(brandInputPayloads.create),
	update: brandValidator.update.parse(brandInputPayloads.update),
	find: brandValidator.find.parse(brandInputPayloads.find),
};
