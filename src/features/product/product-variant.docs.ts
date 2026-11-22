import { Configuration } from '@/config/settings.config';
import {
	ProductCompositionEnum,
	ProductTypeEnum,
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import type { productVariantController } from '@/features/product/product-variant.controller';
import {
	getProductVariantEntityMock,
	productVariantInputPayloads,
} from '@/features/product/product-variant.mock';
import { OrderByEnum } from '@/features/product/product-variant.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Its own file rather than a branch of `product.docs.ts`: documentation is found beside its route
 * file and registered under that file's own name, so this is served as `/docs/product-variant`.
 */
const entitySample = getProductVariantEntityMock() as unknown as Record<
	string,
	unknown
>;

export const docs: Record<
	keyof typeof productVariantController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: 'Get the catalog listing, one row per sellable unit',
		success: {
			status: 200,
			description: 'Product variant list',
			dataSample: {
				entries: [entitySample],
				pagination: {
					page: 1,
					limit: 20,
					total: 1,
				},
				query: productVariantInputPayloads.find,
			},
		},
		withBearerAuth: true,
		withErrors: [401, 403],
		request: {
			notes: "The same catalog as `GET /products`, counted by the thing that is actually sold: a product with three sizes is three rows, and `total` counts variants. Gated on the `product` permission - a variant has none of its own. Read-only: a variant is created and withdrawn through its product's payload, where the rules that hold across the set are enforced. `deleted_at` on the row is the variant's own; a variant whose *product* was deleted carries a null there and a timestamp on `product.deleted_at`, and both only appear under `is_deleted`",
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
					condition:
						'`label` and `brand` sort by the joined translation and brand rows',
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
							'the variant id, not the product id; one or several, and a single value may be sent unwrapped',
					},
					product_id: {
						type: 'string',
						required: false,
						condition: 'every variant of one product',
					},
					term: {
						type: 'string',
						required: false,
						condition: `a number is a variant-id lookup; otherwise at least ${Configuration.get('filter.termMinLength')} characters, matched against the variant SKU as a prefix and against the product translation`,
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
							"which translation names the row; defaults to the request's own language",
					},
					is_sellable: {
						type: 'boolean',
						required: false,
						condition: "the parent product's sellable window",
					},
					track_stock: {
						type: 'boolean',
						required: false,
						condition:
							'whether the variant tracks stock - `true` lists what a goods receipt may name',
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'includes withdrawn variants and the variants of deleted products; needs the `product` delete permission',
					},
				},
			},
			sample: productVariantInputPayloads.find,
		},
	}),
};
