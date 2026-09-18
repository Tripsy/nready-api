import { Configuration } from '@/config/settings.config';
import {
	getProductEntityMock,
	productInputPayloads,
} from '@/features/product/product.mock';
import { OrderByEnum } from '@/features/product/product.validator';
import type { productPublicController } from '@/features/product/product-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Its own file rather than a branch of `product.docs.ts`: documentation is found beside its route
 * file and registered under that file's own name, so this is served as `/docs/product-public`.
 *
 * No `withBearerAuth` and no auth errors - the routes are open, and a doc claiming a requirement
 * the route does not have is worse than none.
 */
const entitySample = getProductEntityMock() as unknown as Record<
	string,
	unknown
>;

export const docs: Record<
	keyof typeof productPublicController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get one product from the storefront, by slug',
		success: {
			status: 200,
			description: 'Product details',
			dataSample: {
				...entitySample,
				cover_image: null,
			},
		},
		withErrors: [404],
		request: {
			notes: "Only a sellable product is addressable here - a draft, an unreleased or a withdrawn one answers 404 rather than revealing that it exists. The slug is unique per language. A product whose `composition` is `bundle` also carries `bundle_groups` and `bundle_items`: a group is a choice taking exactly one of its candidates, and a component is either part of the kit (`group_id` null, `is_optional` false), an independent tick box bounded by its own `quantity`, or a candidate for a group. Each component carries its own `variant` and `label`, since it names a variant of another product, and `prices` holds the signed per-currency delta taking it adds to the bundle - usually negative, and applied to the component's own price rather than the bundle's. Prices come per currency on both figures because this route takes no currency; the client picks its market. `id` is what a cart line names the component by",
			params: {
				slug: {
					type: 'string',
					required: true,
				},
			},
			query: {
				language: {
					type: 'enum',
					required: false,
					values: Configuration.get('language.supported'),
					condition: "defaults to the request's own language",
				},
			},
			sample: productInputPayloads.publicRead,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get the storefront catalog listing',
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
					order_by: 'created_at',
					direction: 'DESC',
					limit: 5,
					page: 1,
					filter: {
						term: 'pizza',
						language: 'en',
					},
				},
			},
		},
		request: {
			notes: 'Deliberately narrower than the dashboard listing: there is no workflow, brand or deleted filter, because a visitor can only ever address the sellable window. Each row carries its brand (with the slug a storefront links), every live variant with its own prices, its axis values resolved to the requested language and its own cover image, and the product’s own cover image',
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
					default: OrderByEnum.CREATED_AT,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: {
						type: 'number',
						required: false,
						condition:
							'how a permalink that must survive a re-slug is resolved',
					},
					term: {
						type: 'string',
						required: false,
						condition: `at least ${Configuration.get('filter.termMinLength')} characters; matches the translation and the variant SKUs`,
					},
					category_id: {
						type: 'number',
						required: false,
						condition:
							'matches the category and everything beneath it',
					},
					brand_id: { type: 'number', required: false },
					tag_id: {
						type: 'array',
						required: false,
						format: 'number[]',
						condition: 'any of the tags, not all of them',
					},
					exclude_id: {
						type: 'number',
						required: false,
						condition:
							'the product a related-products box must not recommend - its own',
					},
					attribute: {
						type: 'array',
						required: false,
						format: '[{ label_id: number; value_term_id?: number[]; min?: number; max?: number }]',
						condition:
							'catalog facets; a range is stated in the unit the category declares and is converted before it is compared',
					},
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
					},
				},
			},
			sample: productInputPayloads.publicFind,
		},
	}),
};
