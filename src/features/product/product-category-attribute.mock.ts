import type ProductCategoryAttributeEntity from '@/features/product/product-category-attribute.entity';
import {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import {
	OrderByEnum,
	ProductCategoryAttributeValidator,
} from '@/features/product/product-category-attribute.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { MeasureUnitEnum } from '@/shared/types/measure-unit.type';
import { mockId } from '@/tests/mocks/uuid.mock';

const validator = new ProductCategoryAttributeValidator('product');

/**
 * The numeric case, since it is the one carrying the machinery worth exercising: a `unit` whose
 * factor produces `value_base`, and the bounds a recorded value is checked against.
 */
export function getProductCategoryAttributeEntityMock(): ProductCategoryAttributeEntity {
	return {
		id: mockId(1),
		category_id: mockId(4),
		attribute_label_id: mockId(11),
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
		type: ProductCategoryAttributeTypeEnum.INPUT,
		unit: MeasureUnitEnum.MILLILITRE,
		prefix: null,
		suffix: null,
		min_value: 100,
		max_value: 3000,
		is_required: true,
		is_filterable: true,
		inherit: true,
		sort_order: 10,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		options: [],
		/*
		 * `category` and `attribute_label` are declared non-optional on the entity but are only
		 * populated when a read joins them, and the definition is addressed by its own columns
		 * everywhere. Cast rather than invented - a fabricated category row here would be a
		 * shape no response ever carries.
		 */
	} as unknown as ProductCategoryAttributeEntity;
}

export const productCategoryAttributeInputPayloads = {
	// Every optional key is spelled out rather than omitted: the shared controller-test builders
	// type the payload against the *parsed* shape, where an optional field is a present key
	// holding `undefined`
	create: {
		category_id: mockId(4),
		attribute_label_id: mockId(8),
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		unit: undefined,
		prefix: undefined,
		suffix: undefined,
		min_value: undefined,
		max_value: undefined,
		is_required: false,
		is_filterable: true,
		inherit: true,
		sort_order: 10,
		options: [
			{ term_id: mockId(12), sort_order: 10 },
			{ term_id: mockId(13), sort_order: 20 },
		],
	},
	update: {
		id: mockId(1),
		scope: undefined,
		value_type: undefined,
		type: undefined,
		unit: undefined,
		prefix: undefined,
		suffix: undefined,
		min_value: undefined,
		max_value: undefined,
		is_required: undefined,
		is_filterable: true,
		inherit: undefined,
		sort_order: 20,
		options: undefined,
	},
	resolve: {
		category_id: [mockId(1), mockId(5)],
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.SORT_ORDER,
		direction: OrderDirectionEnum.ASC,
		filter: {
			category_id: mockId(4),
			is_deleted: false,
		},
	},
};

export const productCategoryAttributeOutputPayloads = {
	create: validator.create.parse(
		productCategoryAttributeInputPayloads.create,
	),
	update: validator.update.parse(
		productCategoryAttributeInputPayloads.update,
	),
	find: validator.find.parse(productCategoryAttributeInputPayloads.find),
};
