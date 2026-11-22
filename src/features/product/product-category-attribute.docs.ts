import { Configuration } from '@/config/settings.config';
import type { productCategoryAttributeController } from '@/features/product/product-category-attribute.controller';
import {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import {
	getProductCategoryAttributeEntityMock,
	productCategoryAttributeInputPayloads,
} from '@/features/product/product-category-attribute.mock';
import { OrderByEnum } from '@/features/product/product-category-attribute.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { MeasureUnitEnum } from '@/shared/types/measure-unit.type';

/**
 * Served as `/docs/product-category-attribute`, since documentation is registered under its route
 * file's own name. The permission gate is still `product` - the folder it sits in - which is right:
 * a definition is the schema of the product form.
 */
const entitySample =
	getProductCategoryAttributeEntityMock() as unknown as Record<
		string,
		unknown
	>;

const optionsFormat = '[{ term_id: EntityId; sort_order?: number }]';

function manageBody(required: boolean) {
	return {
		scope: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductCategoryAttributeScopeEnum),
			default: ProductCategoryAttributeScopeEnum.PRODUCT,
			condition:
				'decides which table a value lands in - product_attribute or product_variant_attribute',
		},
		value_type: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductCategoryAttributeValueTypeEnum),
			default: ProductCategoryAttributeValueTypeEnum.TERM,
			condition: 'storage; orthogonal to type, which is capture',
		},
		type: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductCategoryAttributeTypeEnum),
			default: ProductCategoryAttributeTypeEnum.SELECT,
			condition:
				'input stores number/string/boolean, select and radio store term, checkbox stores term or boolean',
		},
		unit: {
			type: 'enum' as const,
			required: false,
			values: Object.values(MeasureUnitEnum),
			condition:
				'numeric attributes only, and never alongside suffix; changing it rewrites the values already recorded in this category',
		},
		prefix: { type: 'string' as const, required: false },
		suffix: {
			type: 'string' as const,
			required: false,
			condition: 'decoration a measure does not cover - pcs, %',
		},
		min_value: {
			type: 'number' as const,
			required: false,
			condition:
				'numeric attributes only, quoted in the definition’s unit',
		},
		max_value: {
			type: 'number' as const,
			required: false,
			condition:
				'numeric attributes only, quoted in the definition’s unit',
		},
		is_required: {
			type: 'boolean' as const,
			required: false,
			default: false,
		},
		is_filterable: {
			type: 'boolean' as const,
			required: false,
			default: false,
			condition: 'what the storefront offers as a facet',
		},
		inherit: {
			type: 'boolean' as const,
			required: false,
			default: true,
			condition: 'whether descendant categories pick the definition up',
		},
		sort_order: { type: 'number' as const, required: false, default: 0 },
		options: {
			type: 'array' as const,
			required: false,
			format: optionsFormat,
			condition:
				'required and only allowed when value_type is term; a numeric attribute is bounded by min_value / max_value instead',
		},
		...(required
			? {
					category_id: { type: 'string' as const, required: true },
					attribute_label_id: {
						type: 'string' as const,
						required: true,
						condition: 'a term of type attribute_label',
					},
				}
			: {}),
	};
}

export const docs: Record<
	keyof typeof productCategoryAttributeController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Declare an attribute for a product category',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Attribute definition created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: 'A category declares each label once. The definition holds no product data - it is the schema the product form renders from and the validator checks against',
			body: manageBody(true),
			sample: productCategoryAttributeInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get one attribute definition, with its admissible values',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Attribute definition',
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
		description: 'Update an attribute definition',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Attribute definition updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: 'Provide at least one body parameter. Changing unit rewrites value_base on every value already recorded under this label in this category’s subtree, so a range filter keeps meaning the same thing',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: manageBody(false),
			sample: productCategoryAttributeInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete an attribute definition',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Attribute definition deleted with success',
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
		description: 'Restore an attribute definition',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Attribute definition restored with success',
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
	resolve: helperApiInputDocumentation({
		description: 'Resolve the attribute form for a set of categories',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'The definitions that apply, split by scope',
			dataSample: {
				[ProductCategoryAttributeScopeEnum.PRODUCT]: [entitySample],
				[ProductCategoryAttributeScopeEnum.VARIANT]: [],
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'A product sits in several categories, so the set is a union across them and their ancestors: inherited definitions are kept while inherit is true, deduped by label with the deepest category winning',
			query: {
				category_id: {
					type: 'array',
					required: true,
					format: 'number[]',
				},
			},
		},
	}),
	orderUpdate: helperApiInputDocumentation({
		description: 'Reorder the definitions of one category',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'The order was applied',
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: "Positions are the category's definition ids in the order they should be offered - the whole set, since a position only means anything relative to its siblings. Applied ascending, which is how the table is read everywhere",
			body: {
				category_id: { type: 'string', required: true },
				positions: {
					type: 'array',
					required: true,
					format: 'number[]',
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get attribute definitions',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Attribute definition list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: 'sort_order',
					direction: 'ASC',
					limit: 5,
					page: 1,
					filter: {
						category_id: 4,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'Definitions exactly as stored, one category at a time - the inheritance walk is what the resolve route is for',
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
					default: OrderDirectionEnum.ASC,
				},
				filter: {
					category_id: { type: 'string', required: false },
					attribute_label_id: { type: 'string', required: false },
					scope: {
						type: 'enum',
						required: false,
						values: Object.values(
							ProductCategoryAttributeScopeEnum,
						),
					},
					value_type: {
						type: 'enum',
						required: false,
						values: Object.values(
							ProductCategoryAttributeValueTypeEnum,
						),
					},
					is_filterable: { type: 'boolean', required: false },
					is_required: { type: 'boolean', required: false },
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
		},
	}),
};
