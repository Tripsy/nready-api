import type ProductEntity from '@/features/product/product.entity';
import {
	ProductCompositionEnum,
	ProductSaleStatusEnum,
	ProductTypeEnum,
	ProductUnitEnum,
	ProductVatCategoryEnum,
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import {
	OrderByEnum,
	ProductValidator,
} from '@/features/product/product.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const productValidator = new ProductValidator('product');

export function getProductEntityMock(): ProductEntity {
	return {
		id: 1,
		workflow: ProductWorkflowEnum.DRAFT,
		sale_status: ProductSaleStatusEnum.AVAILABLE,
		type: ProductTypeEnum.PHYSICAL,
		composition: ProductCompositionEnum.SIMPLE,
		unit: ProductUnitEnum.PIECE,
		vat_category: ProductVatCategoryEnum.REDUCED,
		available_from: null,
		available_until: null,
		discontinued_at: null,
		details: null,
		brand_id: null,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		variants: [],
		option_groups: [],
		availabilities: [],
		bundle_groups: [],
		bundle_items: [],
		tags: [],
		categories: [],
		attributes: [],
	};
}

export const productInputPayloads = {
	// Every optional key is spelled out rather than omitted: the shared controller-test builders
	// type the payload against the *parsed* shape, where an optional field is a present key
	// holding `undefined`
	create: {
		type: ProductTypeEnum.PHYSICAL,
		composition: ProductCompositionEnum.SIMPLE,
		unit: ProductUnitEnum.PIECE,
		vat_category: ProductVatCategoryEnum.REDUCED,
		available_from: undefined,
		available_until: undefined,
		discontinued_at: undefined,
		brand_id: undefined,
		attributes: undefined,
		availabilities: undefined,
		option_groups: undefined,
		bundle_items: undefined,
		tags: [1, 2],
		contents: [
			{
				language: 'en',
				slug: 'pizza-margherita',
				label: 'Pizza Margherita',
				description: 'Tomato, mozzarella, basil.',
				meta: {
					title: 'Pizza Margherita',
					description: 'Tomato, mozzarella, basil.',
					keywords: 'pizza',
				},
			},
		],
		categories: [1],
		// A single-variant product is the normal case: price and stock hang off the variant, so
		// even a product with nothing to vary carries one
		variants: [
			{
				sku: 'PIZZA-MARG-25',
				barcode: undefined,
				position: 0,
				is_default: true,
				track_stock: false,
				low_stock_threshold: undefined,
				allow_backorder: false,
				cost_price: 12.5,
				prices: [
					{
						currency: 'RON',
						sale_price: 32,
						reference_price: undefined,
						min_price: undefined,
					},
				],
				attributes: [],
			},
		],
	},
	update: {
		id: 1,
		type: undefined,
		composition: undefined,
		unit: undefined,
		vat_category: undefined,
		available_from: undefined,
		available_until: undefined,
		discontinued_at: undefined,
		brand_id: undefined,
		attributes: undefined,
		availabilities: undefined,
		option_groups: undefined,
		bundle_items: undefined,
		categories: undefined,
		variants: undefined,
		tags: [2],
		contents: [
			{
				language: 'en',
				slug: 'pizza-margherita',
				label: 'Pizza Margherita, 32 cm',
				description: 'Tomato, mozzarella, basil.',
				meta: {
					title: 'Pizza Margherita',
					description: 'Tomato, mozzarella, basil.',
					keywords: 'pizza',
				},
			},
		],
	},
	publicRead: {
		slug: 'pizza-margherita',
		language: 'en',
	},
	publicFind: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.CREATED_AT,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'pizza',
			language: 'en',
		},
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'pizza',
			workflow: ProductWorkflowEnum.READY,
			language: 'en',
			is_sellable: true,
			is_deleted: false,
		},
	},
};

export const productOutputPayloads = {
	create: productValidator.create.parse(productInputPayloads.create),
	update: productValidator.update.parse(productInputPayloads.update),
	find: productValidator.find.parse(productInputPayloads.find),
};
