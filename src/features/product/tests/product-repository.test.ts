import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import type ProductEntity from '@/features/product/product.entity';
import { ProductWorkflowEnum } from '@/features/product/product.entity';
import { ProductQuery } from '@/features/product/product.repository';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import {
	type ProductVariantQuery,
	ProductVariantRepository,
	type ResolvedVariant,
} from '@/features/product/product-variant.repository';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

/**
 * The query class is exercised directly, the way `src/tests/repository-ts-term.test.ts` does:
 * `filterByTerm` builds raw SQL that no service-level test can see, because the service holds a
 * mocked query whose `filterByTerm` never runs.
 *
 * The SQL is worth pinning. `product.sku` is gone, so a code lookup now reaches the variant, and
 * two details decide whether it works at all - the subquery alias, and the `lower(...) LIKE`
 * spelling the prefix index needs.
 */
describe('ProductQuery.filterByTerm', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	function build() {
		const mock = createMockRepository<ProductEntity, ProductQuery>();
		const query = new ProductQuery(mock.repository);

		return { query, queryBuilder: mock.queryBuilder };
	}

	/** The last `andWhere` the term filter produced, condition and parameters. */
	function lastCondition(
		queryBuilder: ReturnType<typeof build>['queryBuilder'],
	) {
		const calls = queryBuilder.andWhere.mock.calls;

		return calls[calls.length - 1];
	}

	it('ignores a term below the minimum length', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('ab');

		expect(queryBuilder.andWhere).not.toHaveBeenCalled();
	});

	/*
	 * `to_tsquery('simple', ':*')` is itself a syntax error, so a term that survives no token has
	 * to skip the filter rather than reach Postgres.
	 */
	it('ignores a term that carries no searchable text', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('+++()');

		expect(queryBuilder.andWhere).not.toHaveBeenCalled();
	});

	it('searches the translation through the indexed expression', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('margherita');

		const [condition, parameters] = lastCondition(queryBuilder);

		// Character-identical to the GIN index in `1788300000000-product-content-search.ts`,
		// or the planner silently falls back to a sequential scan
		expect(String(condition)).toContain(
			"to_tsvector('simple', COALESCE(content.label, '') || ' ' || COALESCE(content.description, '')) @@ to_tsquery('simple', :term || ':*')",
		);
		expect(parameters).toMatchObject({ term: 'margherita' });
	});

	it('matches variant SKUs through a subquery of its own', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('PRD-0001');

		const [condition, parameters] = lastCondition(queryBuilder);
		const sql = String(condition);

		expect(sql).toContain('FROM product_variant term_variant');
		expect(sql).toContain('term_variant.product_id = product.id');
		expect(parameters).toMatchObject({ skuTerm: 'PRD-0001%' });
	});

	/*
	 * The listings join `variant` pinned to `is_default = true`. Reusing that alias would find a
	 * product only by its default variant's code and silently miss every other one.
	 */
	it('does not reuse the default-variant alias the listings join', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('PRD-0001');

		const sql = String(lastCondition(queryBuilder)[0]);

		expect(sql).not.toMatch(/\bvariant\.sku\b/);
		expect(sql).not.toContain('is_default');
	});

	// `ILIKE` cannot use `IDX_product_variant_sku_prefix`; `lower(...) LIKE lower(...)` can
	it('spells the code match the way the prefix index can serve', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('PRD-0001');

		const sql = String(lastCondition(queryBuilder)[0]);

		expect(sql).toContain('lower(term_variant.sku) LIKE lower(:skuTerm)');
		expect(sql).not.toContain('ILIKE');
	});

	it('searches the name and the codes together, not one or the other', () => {
		const { query, queryBuilder } = build();

		query.filterByTerm('margherita');

		const sql = String(lastCondition(queryBuilder)[0]);

		expect(sql).toContain('OR EXISTS');
	});
});

/**
 * `syncVariants` is exercised through the extended repository rather than the service, because the
 * decision under test is its own: whether a variant's axis values are written at all.
 *
 * `syncAttributes` replaces the set it is given, so an empty array clears every stored value. A
 * payload that says nothing about the attributes has to skip the call entirely - the dashboard
 * sends no `variants[].attributes`, and writing `[]` on its behalf would make an edit that only
 * touches the product name destroy what tells the sibling variants apart.
 */
describe('ProductVariantRepository.syncVariants', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const savedVariantId = mockId(7);

	async function syncOneVariant(attributes: ResolvedVariant['attributes']) {
		const mock = createMockRepository<
			ProductVariantEntity,
			ProductVariantQuery
		>();

		mock.repository.save.mockImplementation((async (row: unknown) => ({
			...(row as object),
			id: savedVariantId,
		})) as never);

		const manager = {
			getRepository: jest.fn(() => mock.repository),
		} as unknown as EntityManager;

		jest.spyOn(ProductVariantRepository, 'syncPrices').mockResolvedValue(
			undefined,
		);

		const syncAttributes = jest
			.spyOn(ProductVariantRepository, 'syncAttributes')
			.mockResolvedValue(undefined);

		await ProductVariantRepository.syncVariants(manager, mockId(1), [
			{
				sku: 'PIZZA-MARG-25',
				barcode: undefined,
				position: 0,
				is_default: true,
				track_stock: false,
				low_stock_threshold: undefined,
				allow_backorder: false,
				cost_price: undefined,
				prices: [],
				attributes,
			},
		]);

		return syncAttributes;
	}

	it('leaves the axis values alone when the payload omits them', async () => {
		expect(await syncOneVariant(undefined)).not.toHaveBeenCalled();
	});

	it('clears them when the payload sends an empty array', async () => {
		expect(await syncOneVariant([])).toHaveBeenCalledWith(
			expect.anything(),
			savedVariantId,
			[],
		);
	});
});

/**
 * The filter is tri-state - absent is "any", `false` is the dashboard's "Not sellable" - so the
 * query class is exercised directly to see which of the three actually reaches the builder. A
 * service-level test cannot: it holds a mocked query whose `filterBySellable` never runs.
 */
describe('ProductQuery.filterBySellable', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	function build() {
		const mock = createMockRepository<ProductEntity, ProductQuery>();

		return {
			query: new ProductQuery(mock.repository),
			queryBuilder: mock.queryBuilder,
		};
	}

	/** The condition the filter produced, whitespace collapsed so it matches as one line. */
	function condition(
		queryBuilder: ReturnType<typeof build>['queryBuilder'],
	): string {
		const calls = queryBuilder.andWhere.mock.calls;

		return String(calls[calls.length - 1][0])
			.replace(/\s+/g, ' ')
			.trim();
	}

	it('filters nothing when the value is absent', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(undefined);

		expect(queryBuilder.andWhere).not.toHaveBeenCalled();
	});

	it('asks for the sellable window when true', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(true);

		const sql = condition(queryBuilder);

		expect(sql).toContain('product.available_from');
		expect(sql).not.toContain('NOT');
	});

	/*
	 * The regression this guards: a withdrawal dated in the future leaves `sale_status` on
	 * `available` - `resolveSaleStatus` compares against now - and the other two clauses say
	 * nothing about it, so the product went on selling until the nightly cron caught the column
	 * up. Comparing the timestamp here is what closes that window.
	 */
	it('excludes a product whose withdrawal date has passed', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(true);

		expect(condition(queryBuilder)).toContain(
			'product.discontinued_at IS NULL OR product.discontinued_at > :now',
		);
	});

	/*
	 * `sale_status` is only caught up on a schedule, so reading it here would hide a product until
	 * the pass after its window opened and keep selling one until the pass after it closed. Every
	 * deadline is compared directly instead, and the column stays a display projection.
	 */
	it('does not read the derived sale_status column', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(true);

		expect(condition(queryBuilder)).not.toContain('sale_status');
	});

	/*
	 * The regression this guards: `sale_status` is derived from the availability timestamps
	 * alone, so a product with no dates set computes to `available` however unfinished it is.
	 * A draft then satisfied the predicate - listed under the dashboard's "Sellable now", and
	 * served to visitors at its public URL, which `resolvePublicRef` documents as a 404.
	 */
	it('requires the product to be published', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(true);

		const calls = queryBuilder.andWhere.mock.calls;
		const [sql, params] = calls[calls.length - 1];

		expect(String(sql).replace(/\s+/g, ' ')).toContain(
			'product.workflow = :readyWorkflow',
		);
		expect(params).toMatchObject({
			readyWorkflow: ProductWorkflowEnum.READY,
		});
	});

	/*
	 * The regression this guards: a falsy check reads `false` as "not supplied" and answers the
	 * dashboard's "Not sellable" with the whole catalog.
	 */
	it('asks for the complement when false, rather than filtering nothing', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(false);

		expect(queryBuilder.andWhere).toHaveBeenCalled();
		expect(condition(queryBuilder)).toMatch(/^NOT \(/);
	});

	/*
	 * One predicate, negated whole. Negating each half separately would drop rows to
	 * three-valued logic, and the `IS NULL` branches are what keep every clause true or false -
	 * a product with no closing date is sellable, not unknown.
	 */
	it('negates the whole predicate in a single condition', () => {
		const { query, queryBuilder } = build();

		query.filterBySellable(false);

		expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);

		const sql = condition(queryBuilder);

		expect(sql).toContain('product.available_from IS NULL');
		expect(sql).toContain('product.available_until IS NULL');
		expect(sql).toContain('product.discontinued_at IS NULL');
	});
});
