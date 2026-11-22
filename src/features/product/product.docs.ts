import { Configuration } from '@/config/settings.config';
import type { productController } from '@/features/product/product.controller';
import {
	ProductCompositionEnum,
	ProductTypeEnum,
	ProductUnitEnum,
	ProductVatCategoryEnum,
	ProductWorkflowEnum,
	WORKFLOW_TRANSITIONS,
} from '@/features/product/product.entity';
import {
	getProductEntityMock,
	productInputPayloads,
} from '@/features/product/product.mock';
import { OrderByEnum } from '@/features/product/product.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getProductEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Rendered as `draft -> pending_review`, one hop per entry. */
const workflowTransitionNote = Object.entries(WORKFLOW_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ') || '(none)'}`)
	.join('; ');

const contentsFormat =
	'[{ language: string; slug: string; label: string; description?: string; meta?: { title?: string; description?: string; keywords?: string } }]';

const variantsFormat =
	'[{ sku: string; barcode?: string; position?: number; is_default: boolean; track_stock?: boolean; low_stock_threshold?: number; allow_backorder?: boolean; cost_price?: number; prices: [{ currency: string; sale_price: number; reference_price?: number; min_price?: number }]; attributes?: [{ attribute_label_id: EntityId; value_term_id?: EntityId; value_numeric?: number; value_text?: string; value_boolean?: boolean }] }]';

const attributesFormat =
	'[{ attribute_label_id: EntityId; value_term_id?: EntityId; value_numeric?: number; value_text?: string; value_boolean?: boolean }]';

const availabilitiesFormat =
	'[{ day_of_week?: number; starts_at?: string; ends_at?: string }]';

const optionGroupsFormat =
	'[{ label_id: EntityId; min_select?: number; max_select?: number; position?: number; options: [{ label_id: EntityId; position?: number; is_default?: boolean; prices: [{ currency: string; price_delta: number }] }] }]';

const bundleGroupsFormat = '[{ label_id: EntityId; position?: number }]';

const bundleItemsFormat =
	'[{ variant_id: EntityId; quantity?: number; position?: number; group_label_id?: EntityId; is_optional?: boolean; is_default?: boolean; prices: [{ currency: string; price_delta: number }] }]';

/** Shared by `create` and `update`; only `required` differs between the two. */
function manageBody(required: boolean) {
	return {
		type: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductTypeEnum),
			default: ProductTypeEnum.PHYSICAL,
			condition:
				'how the product is fulfilled; orthogonal to composition',
		},
		composition: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductCompositionEnum),
			default: ProductCompositionEnum.SIMPLE,
			condition:
				'a bundle needs two units that are always included - one component at quantity 2, or two components',
		},
		unit: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductUnitEnum),
			default: ProductUnitEnum.PIECE,
		},
		vat_category: {
			type: 'enum' as const,
			required: false,
			values: Object.values(ProductVatCategoryEnum),
			default: ProductVatCategoryEnum.STANDARD,
			condition: 'unused on a bundle - its components carry their own',
		},
		available_from: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
			condition: 'a future date makes the product coming_soon',
		},
		available_until: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
			condition: 'must fall after available_from',
		},
		discontinued_at: {
			type: 'string' as const,
			format: 'date-time',
			required: false,
			condition: 'permanent withdrawal from the catalog',
		},
		brand_id: { type: 'string' as const, required: false },
		contents: {
			type: 'array' as const,
			required,
			format: contentsFormat,
			condition: 'one entry per language; slug must be unique',
		},
		categories: {
			type: 'array' as const,
			required,
			format: 'number[]',
			condition:
				'the attribute form is resolved from these, so at least one is required',
		},
		tags: { type: 'array' as const, required: false, format: 'number[]' },
		variants: {
			type: 'array' as const,
			required,
			format: variantsFormat,
			condition:
				"at least one, exactly one is_default; price and stock hang off the variant. Omitting a variant's attributes keeps its stored axis values, [] clears them",
		},
		attributes: {
			type: 'array' as const,
			required: false,
			format: attributesFormat,
			condition:
				'each label must be declared by the product category attributes; exactly one value column per entry',
		},
		availabilities: {
			type: 'array' as const,
			required: false,
			format: availabilitiesFormat,
			condition:
				'recurring windows; no entry at all means unrestricted. day_of_week is an ISO 8601 weekday, 1 = Monday',
		},
		option_groups: {
			type: 'array' as const,
			required: false,
			format: optionGroupsFormat,
			condition:
				'cardinality is min_select / max_select alone; deltas are per currency and signed',
		},
		bundle_groups: {
			type: 'array' as const,
			required: false,
			format: bundleGroupsFormat,
			condition:
				'the choices offered inside a bundle; exactly one candidate is taken, and the candidates are the components naming the group through group_label_id - at least two of them',
		},
		bundle_items: {
			type: 'array' as const,
			required: false,
			format: bundleItemsFormat,
			condition:
				'the components of a bundle; is_default and prices are refused on one the customer does not choose, is_optional is refused inside a group, and quantity is a ceiling rather than a count only on an optional one',
		},
	};
}

export const docs: Record<
	keyof typeof productController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new product',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Product created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: 'A product starts in the draft workflow; use the workflow route to move it on. sale_status is derived from the availability dates and is never sent',
			body: manageBody(true),
			sample: productInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get product details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Product details, with every branch it owns',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Omitting language returns every translation, which is what the editing form needs',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			query: {
				language: {
					type: 'enum',
					required: false,
					values: Configuration.get('language.supported'),
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update product',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Product updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: 'Provide at least one body parameter. An omitted branch is left alone; an empty array clears it. A contents array replaces the stored entries for the languages it carries',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: manageBody(false),
			sample: productInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete product',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Product deleted with success',
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
		description: 'Restore product',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Product restored with success',
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
	workflowUpdate: helperApiInputDocumentation({
		description: 'Move a product to another workflow status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Product workflow updated with success',
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${workflowTransitionNote}`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
				workflow: {
					type: 'enum',
					required: true,
					values: Object.values(ProductWorkflowEnum),
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get products',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Product list',
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
						term: 'pizza',
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'The dashboard listing: it can address every product, whatever its workflow. Each row carries its default variant and that variant’s prices',
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
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: {
						type: 'array',
						required: false,
						format: 'number[]',
						condition:
							'one id or several; a single value may be sent unwrapped',
					},
					term: {
						type: 'string',
						required: false,
						condition: `at least ${Configuration.get('filter.termMinLength')} characters; matches the translation and the variant SKUs`,
					},
					workflow: {
						type: 'enum',
						required: false,
						values: Object.values(ProductWorkflowEnum),
					},
					type: {
						type: 'enum',
						required: false,
						values: Object.values(ProductTypeEnum),
					},
					composition: {
						type: 'enum',
						required: false,
						values: Object.values(ProductCompositionEnum),
					},
					brand_id: { type: 'string', required: false },
					category_id: {
						type: 'string',
						required: false,
						condition:
							'matches the category and everything beneath it',
					},
					tag_id: { type: 'string', required: false },
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
						condition:
							'also decides which translation the rows carry',
					},
					is_sellable: {
						type: 'boolean',
						required: false,
						condition:
							'available now and inside its catalog window; recurring hours are not consulted',
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: productInputPayloads.find,
		},
	}),
};
