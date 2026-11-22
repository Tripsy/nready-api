import { jest } from '@jest/globals';
import { productInputPayloads } from '@/features/product/product.mock';
import { ProductValidator } from '@/features/product/product.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';

beforeEach(() => {
	jest.restoreAllMocks();
});

const productValidator = new ProductValidator('product');

type ValidatorMethod = keyof Pick<
	typeof productValidator,
	'create' | 'update' | 'find' | 'publicFind' | 'publicRead' | 'publicStock'
>;

const validator = 'ProductValidator';
const listSchemas: ValidatorMethod[] = [
	'create',
	'update',
	'find',
	'publicFind',
	'publicRead',
	'publicStock',
];

/** The valid create payload, with one branch swapped for the case under test. */
const createWith = (overrides: Record<string, unknown>) =>
	productValidator.create.safeParse({
		...productInputPayloads.create,
		...overrides,
	});

const [defaultVariant] = productInputPayloads.create.variants;

describe(validator, () => {
	listSchemas.forEach((schemaName) => {
		it(`${schemaName}() accepts valid payload`, () => {
			const schema = productValidator[schemaName];
			const payload = productInputPayloads[schemaName];
			const validated = schema.safeParse(payload);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	describe('contents', () => {
		it('rejects an empty contents array', () => {
			const validated = createWith({ contents: [] });

			expect(validated.success).toBe(false);
		});

		it('rejects two contents sharing a language', () => {
			const [content] = productInputPayloads.create.contents;

			const validated = createWith({
				contents: [content, { ...content, slug: 'other-slug' }],
			});

			expect(validated.success).toBe(false);
		});

		it('lowercases and trims the slug', () => {
			const [content] = productInputPayloads.create.contents;

			const validated = createWith({
				contents: [{ ...content, slug: '  Mixed-Case-Slug ' }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.contents[0].slug).toBe(
					'mixed-case-slug',
				);
			}, validated);
		});
	});

	describe('categories', () => {
		// The attribute form is resolved from them and the public URL is built from them, so a
		// product filed under nothing has neither
		it('rejects a create with no category', () => {
			expect(createWith({ categories: [] }).success).toBe(false);
		});

		it('rejects an update that empties the category list', () => {
			const validated = productValidator.update.safeParse({
				id: 1,
				categories: [],
			});

			expect(validated.success).toBe(false);
		});
	});

	describe('variants', () => {
		it('rejects a create with no variant', () => {
			expect(createWith({ variants: [] }).success).toBe(false);
		});

		// The partial unique index enforces *at most* one default; nothing in the schema
		// enforces at least one, and nothing can see the whole payload
		it('rejects two default variants', () => {
			const validated = createWith({
				variants: [
					defaultVariant,
					{ ...defaultVariant, sku: 'OTHER', is_default: true },
				],
			});

			expect(validated.success).toBe(false);
		});

		it('rejects a payload where no variant is the default', () => {
			const validated = createWith({
				variants: [{ ...defaultVariant, is_default: false }],
			});

			expect(validated.success).toBe(false);
		});

		it('rejects two variants sharing a SKU', () => {
			const validated = createWith({
				variants: [
					defaultVariant,
					{ ...defaultVariant, is_default: false },
				],
			});

			expect(validated.success).toBe(false);
		});

		it('accepts position 0 - the first display slot is not a missing value', () => {
			const validated = createWith({
				variants: [{ ...defaultVariant, position: 0 }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('accepts a cost_price of zero', () => {
			const validated = createWith({
				variants: [{ ...defaultVariant, cost_price: 0 }],
			});

			expect(validated.success).toBe(true);
		});

		it('rejects a negative cost_price', () => {
			const validated = createWith({
				variants: [{ ...defaultVariant, cost_price: -1 }],
			});

			expect(validated.success).toBe(false);
		});

		/*
		 * `attributes` carries no default, unlike `prices` beside it: `syncAttributes` reads
		 * an empty array as "clear the axis values", so a default would turn every payload
		 * that omits the key into one that wipes them. The dashboard sends no
		 * `variants[].attributes` at all.
		 */
		it('leaves an omitted attributes key absent rather than defaulting it', () => {
			const { attributes: _attributes, ...withoutAttributes } =
				defaultVariant;

			const validated = createWith({
				variants: [withoutAttributes],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.variants[0].attributes).toBeUndefined();
			}, validated);
		});

		it('keeps an explicit empty attributes array, which clears the values', () => {
			const validated = createWith({
				variants: [{ ...defaultVariant, attributes: [] }],
			});

			withDebugValidated(() => {
				expect(validated.data?.variants[0].attributes).toEqual([]);
			}, validated);
		});
	});

	describe('prices', () => {
		const withPrice = (price: Record<string, unknown>) =>
			createWith({
				variants: [{ ...defaultVariant, prices: [price] }],
			});

		it('upper-cases the currency so one market cannot be quoted twice', () => {
			const validated = withPrice({ currency: 'ron', sale_price: 10 });

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.variants[0].prices[0].currency).toBe(
					'RON',
				);
			}, validated);
		});

		it('rejects a currency that is not three letters', () => {
			expect(
				withPrice({ currency: 'RONN', sale_price: 10 }).success,
			).toBe(false);
		});

		// Mirrors the table's `@Check (sale_price > 0)`, so the failure is a 422 and not the
		// masked 500 a constraint violation becomes
		it('rejects a sale price of zero', () => {
			expect(withPrice({ currency: 'RON', sale_price: 0 }).success).toBe(
				false,
			);
		});

		it('rejects a min_price above the sale price', () => {
			expect(
				withPrice({ currency: 'RON', sale_price: 10, min_price: 20 })
					.success,
			).toBe(false);
		});

		it('accepts a min_price equal to the sale price', () => {
			expect(
				withPrice({ currency: 'RON', sale_price: 10, min_price: 10 })
					.success,
			).toBe(true);
		});

		/*
		 * `min_price` is a floor, not a requirement - a market may be quoted without one. The
		 * `refine` that compares it against `sale_price` has to let an absent value through, or
		 * the optional field is required in practice by the rule meant to bound it. Three shapes
		 * reach it as absent: the key omitted, an explicit `null`, and the empty string a form
		 * submits for a cleared number input.
		 */
		it.each([
			['omitted', {}],
			['null', { min_price: null }],
			['an empty string', { min_price: '' }],
		])('accepts a price with min_price %s', (_label, patch) => {
			const validated = withPrice({
				currency: 'RON',
				sale_price: 10,
				...patch,
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(
					validated.data?.variants[0].prices[0].min_price,
				).toBeUndefined();
			}, validated);
		});
	});

	describe('attributes', () => {
		it('rejects a value that fills no column', () => {
			const validated = createWith({
				attributes: [{ attribute_label_id: 8 }],
			});

			expect(validated.success).toBe(false);
		});

		it('rejects a value that fills two columns', () => {
			const validated = createWith({
				attributes: [
					{
						attribute_label_id: 8,
						value_term_id: 13,
						value_numeric: 5,
					},
				],
			});

			expect(validated.success).toBe(false);
		});

		it('accepts a boolean-only value', () => {
			const validated = createWith({
				attributes: [{ attribute_label_id: 8, value_boolean: false }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		// Derived from `value_numeric` through the definition's unit factor, so a payload
		// must not be able to state a figure the number does not agree with
		it('drops a value_base supplied by the payload', () => {
			const validated = createWith({
				attributes: [
					{
						attribute_label_id: 8,
						value_numeric: 500,
						value_base: 999999,
					},
				],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.attributes?.[0]).not.toHaveProperty(
					'value_base',
				);
			}, validated);
		});
	});

	describe('availabilities', () => {
		const window = { starts_at: '12:00', ends_at: '15:00' };

		it('accepts a window with no weekday - that means every day', () => {
			expect(createWith({ availabilities: [window] }).success).toBe(true);
		});

		it('accepts day_of_week 7, which is Sunday', () => {
			expect(
				createWith({ availabilities: [{ ...window, day_of_week: 7 }] })
					.success,
			).toBe(true);
		});

		it('rejects day_of_week 0 - the numbering is ISO-8601, not JavaScript', () => {
			expect(
				createWith({ availabilities: [{ ...window, day_of_week: 0 }] })
					.success,
			).toBe(false);
		});

		it('rejects a window that ends before it starts', () => {
			expect(
				createWith({
					availabilities: [{ starts_at: '15:00', ends_at: '12:00' }],
				}).success,
			).toBe(false);
		});
	});

	describe('option groups', () => {
		const option = (label_id: number) => ({
			label_id,
			prices: [{ currency: 'RON', price_delta: 0 }],
		});

		it('accepts a signed delta - declining something may reduce the price', () => {
			const validated = createWith({
				option_groups: [
					{
						label_id: 8,
						min_select: 0,
						max_select: 1,
						options: [
							{
								label_id: 12,
								prices: [{ currency: 'RON', price_delta: -5 }],
							},
						],
					},
				],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('rejects a group offering no answers', () => {
			expect(
				createWith({
					option_groups: [{ label_id: 8, options: [] }],
				}).success,
			).toBe(false);
		});

		it('rejects max_select below min_select', () => {
			expect(
				createWith({
					option_groups: [
						{
							label_id: 8,
							min_select: 2,
							max_select: 1,
							options: [option(12), option(13)],
						},
					],
				}).success,
			).toBe(false);
		});

		// Spans the group and its answers, which a row-level constraint cannot see
		it('rejects a group asking for more answers than it offers', () => {
			expect(
				createWith({
					option_groups: [
						{
							label_id: 8,
							min_select: 2,
							options: [option(12)],
						},
					],
				}).success,
			).toBe(false);
		});

		it('rejects two preselected answers in one group', () => {
			expect(
				createWith({
					option_groups: [
						{
							label_id: 8,
							options: [
								{ ...option(12), is_default: true },
								{ ...option(13), is_default: true },
							],
						},
					],
				}).success,
			).toBe(false);
		});
	});

	describe('bundle components', () => {
		it('rejects a component with no quantity left', () => {
			expect(
				createWith({
					bundle_items: [{ variant_id: 3, quantity: 0 }],
				}).success,
			).toBe(false);
		});

		it('defaults an omitted quantity rather than rejecting it', () => {
			const validated = createWith({
				bundle_items: [{ variant_id: 3 }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('defaults a component to always included and free of deltas', () => {
			const validated = createWith({
				bundle_items: [{ variant_id: 3 }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);

			expect(validated.data?.bundle_items?.[0]).toMatchObject({
				is_optional: false,
				is_default: false,
				prices: [],
			});
		});

		it('accepts an optional component carrying a signed delta', () => {
			const validated = createWith({
				bundle_items: [
					{
						// On an optional component this is the ceiling, not a count
						variant_id: 3,
						quantity: 2,
						is_optional: true,
						is_default: true,
						prices: [{ currency: 'ron', price_delta: -10.5 }],
					},
				],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);

			// Upper-cased by `currencySchema`, so one market cannot arrive as two rows
			expect(validated.data?.bundle_items?.[0].prices[0]).toEqual({
				currency: 'RON',
				price_delta: -10.5,
			});
		});

		it('rejects preselecting a component that is always included', () => {
			expect(
				createWith({
					bundle_items: [{ variant_id: 3, is_default: true }],
				}).success,
			).toBe(false);
		});

		it('rejects a delta on a component that is always included', () => {
			expect(
				createWith({
					bundle_items: [
						{
							variant_id: 3,
							prices: [{ currency: 'RON', price_delta: -10 }],
						},
					],
				}).success,
			).toBe(false);
		});
	});

	describe('bundle choice groups', () => {
		it('accepts a swap: one group of two candidates, each priced', () => {
			const validated = createWith({
				bundle_groups: [{ label_id: 41, position: 0 }],
				bundle_items: [
					{ variant_id: 3, quantity: 1 },
					{ variant_id: 4, quantity: 1 },
					{
						variant_id: 9,
						group_label_id: 41,
						is_default: true,
						prices: [{ currency: 'RON', price_delta: -5 }],
					},
					{
						variant_id: 10,
						group_label_id: 41,
						prices: [{ currency: 'RON', price_delta: -5 }],
					},
				],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('accepts preselecting and pricing a candidate, which an ungrouped mandatory component cannot carry', () => {
			const validated = createWith({
				bundle_groups: [{ label_id: 41 }],
				bundle_items: [
					{
						variant_id: 9,
						group_label_id: 41,
						is_default: true,
						prices: [{ currency: 'RON', price_delta: -5 }],
					},
				],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);

			// The group decides how many candidates are taken, so the row itself is not optional
			expect(validated.data?.bundle_items?.[0]).toMatchObject({
				group_label_id: 41,
				is_optional: false,
			});
		});

		it('rejects a candidate that is also optional on its own terms', () => {
			expect(
				createWith({
					bundle_groups: [{ label_id: 41 }],
					bundle_items: [
						{
							variant_id: 9,
							group_label_id: 41,
							is_optional: true,
						},
					],
				}).success,
			).toBe(false);
		});

		/*
		 * A choice means exactly one, and says so in its shape - a bound counting candidate rows
		 * could not state the mixed pack that would want it, since a bundle is measured in units.
		 */
		it('ignores a cardinality bound, which a bundle choice does not carry', () => {
			const validated = createWith({
				bundle_groups: [{ label_id: 41, min_select: 2, max_select: 1 }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);

			expect(validated.data?.bundle_groups?.[0]).toEqual({
				label_id: 41,
				position: undefined,
			});
		});

		it('accepts a group carrying nothing but its prompt', () => {
			const validated = createWith({
				bundle_groups: [{ label_id: 41 }],
				bundle_items: [{ variant_id: 9, group_label_id: 41 }],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	describe('availability window on the product', () => {
		it('rejects available_until on or before available_from', () => {
			expect(
				createWith({
					available_from: '2026-09-01T10:00:00.000Z',
					available_until: '2026-08-01T10:00:00.000Z',
				}).success,
			).toBe(false);
		});

		it('accepts either date on its own', () => {
			expect(
				createWith({ available_until: '2026-09-01T10:00:00.000Z' })
					.success,
			).toBe(true);
		});
	});

	/*
	 * The product carries no code of its own any more - `product_variant.sku` is the only SKU in
	 * the system, and a payload naming a product-level one is ignored rather than honoured.
	 */
	describe('the product has no sku', () => {
		it('create() drops a sku from the payload', () => {
			const validated = createWith({ sku: 'PIZZA-MARG' });

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data).not.toHaveProperty('sku');
			}, validated);
		});

		it('update() does not count a sku as an updatable field', () => {
			// Nothing updatable was supplied, so `params_at_least_one` still fires
			expect(
				productValidator.update.safeParse({ id: 1, sku: 'ANY' })
					.success,
			).toBe(false);
		});

		/*
		 * The listing sorts on the product's own columns only. `label` lives on the content
		 * join and `sku` on the variant one - neither is a column of `product`, and admitting
		 * either would put a join alias into the API contract.
		 */
		it.each(['sku', 'label', 'updated_at'])(
			'find() rejects order_by=%s',
			(orderBy) => {
				expect(
					productValidator.find.safeParse({ order_by: orderBy })
						.success,
				).toBe(false);
			},
		);

		it('find() accepts order_by=created_at', () => {
			const validated = productValidator.find.safeParse({
				order_by: 'created_at',
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.order_by).toBe('created_at');
			}, validated);
		});
	});

	describe('update', () => {
		it('rejects a payload carrying only the id', () => {
			expect(productValidator.update.safeParse({ id: 1 }).success).toBe(
				false,
			);
		});

		it('accepts a single branch on its own', () => {
			const validated = productValidator.update.safeParse({
				id: 1,
				tags: [2],
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('ignores workflow - it moves through its own route', () => {
			// Nothing updatable was supplied, so `params_at_least_one` still fires
			expect(
				productValidator.update.safeParse({
					id: 1,
					workflow: 'ready',
				}).success,
			).toBe(false);
		});

		it('ignores sale_status - it is derived from the availability dates', () => {
			expect(
				productValidator.update.safeParse({
					id: 1,
					sale_status: 'available',
				}).success,
			).toBe(false);
		});
	});

	describe('publicFind facets', () => {
		const facet = (value: Record<string, unknown>) =>
			productValidator.publicFind.safeParse({
				filter: { attribute: [value] },
			});

		it('accepts a range facet', () => {
			const validated = facet({ label_id: 11, min: 300, max: 600 });

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('wraps a single term id into a list', () => {
			const validated = facet({ label_id: 8, value_term_id: 13 });

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(
					validated.data?.filter.attribute?.[0].value_term_id,
				).toEqual([13]);
			}, validated);
		});

		it('rejects a facet naming a label and nothing to match on', () => {
			expect(facet({ label_id: 8 }).success).toBe(false);
		});
	});

	// A visitor can only ever address the sellable window, so a filter that could widen it
	// must not exist on this schema at all
	describe('publicFind is narrower than find', () => {
		it('drops a workflow filter', () => {
			const validated = productValidator.publicFind.safeParse({
				filter: { workflow: 'draft' },
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.filter).not.toHaveProperty('workflow');
			}, validated);
		});

		it('drops an is_deleted filter', () => {
			const validated = productValidator.publicFind.safeParse({
				filter: { is_deleted: true },
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.filter).not.toHaveProperty('is_deleted');
			}, validated);
		});
	});
});
