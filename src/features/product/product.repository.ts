import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import ProductEntity, {
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ProductQuery extends RepositoryAbstract<ProductEntity> {
	constructor(repository: Repository<ProductEntity>) {
		super(repository, ProductEntity.NAME);
	}

	/**
	 * A numeric term is an id lookup; anything else searches the translation and the codes.
	 *
	 * The full-text branch requires the `content` alias to be joined by the caller, and the
	 * expression must stay character-identical to the GIN index in
	 * `1788300000000-product-content-search.ts` - Postgres only uses an expression index when
	 * the query repeats it verbatim, and a mismatch degrades to a sequential scan with nothing
	 * reported. The same holds for the code branch and
	 * `IDX_product_variant_sku_prefix`: it is `lower(sku) LIKE lower(:term)` and not `ILIKE`,
	 * because `ILIKE` cannot use that index at all.
	 *
	 * A code is looked up as often as a name, so the variant SKUs are checked alongside - as a
	 * prefix match rather than part of the tsvector, since a SKU is one token with punctuation
	 * in it that the `simple` configuration would split apart.
	 *
	 * The subquery is what makes it correct rather than the `variant` alias the listings already
	 * join: that join is pinned to `is_default = true`, so reusing it would silently fail to
	 * find a product by any code but its default one.
	 */
	filterByTerm(term?: string): this {
		if (!term) {
			return this;
		}

		if (term.length < Configuration.get('filter.termMinLength')) {
			return this;
		}

		const tsTerm = this.prepareTsTerm(term);

		if (tsTerm === '') {
			return this;
		}

		return this.filterRaw(
			`(
				to_tsvector('simple', COALESCE(content.label, '') || ' ' || COALESCE(content.description, '')) @@ to_tsquery('simple', :term || ':*')
				OR EXISTS (
					SELECT 1
					FROM product_variant term_variant
					WHERE term_variant.product_id = product.id
						AND term_variant.deleted_at IS NULL
						AND lower(term_variant.sku) LIKE lower(:skuTerm)
				)
			)`,
			{ term: tsTerm, skuTerm: `${term.trim()}%` },
		);
	}

	/**
	 * What a storefront may show: finished, past its opening date, inside its selling window and
	 * not withdrawn.
	 *
	 * **Derived from the timestamps, never from `sale_status`.** That column is a projection
	 * `recompute-product-sale-status.cron.ts` catches up on a schedule, so reading it here would
	 * hide a product until the pass after its window opened and keep selling one until the pass
	 * after it closed. All three deadlines are therefore compared directly, `discontinued_at`
	 * included - a withdrawal scheduled for a future date is the one the other two clauses say
	 * nothing about.
	 *
	 * `workflow` is the one condition no timestamp implies. A product nobody ever published has no
	 * dates set, so every deadline clause passes and it would be public; the workflow clause is
	 * what keeps a draft out.
	 *
	 * `product_availability` is *not* consulted. Those are recurring windows within the product's
	 * life and leave `sale_status` untouched - an out-of-hours dish is still listed, it just
	 * cannot be ordered right now. See `.claude/rules/product.md` §9.
	 *
	 * The filter is tri-state, so the guard tests for an absent value rather than a falsy one:
	 * `false` is the dashboard's "Not sellable" and asks for the complement, which a falsy check
	 * would answer with the whole catalog. The whole predicate is negated rather than each half,
	 * and it is one `filterRaw` for that reason - every clause resolves to true or false (the
	 * `IS NULL` branches make sure of it, and `workflow` is not nullable), so `NOT` cannot lose a
	 * row to three-valued logic.
	 */
	filterBySellable(isSellable?: boolean): this {
		if (isSellable === undefined || isSellable === null) {
			return this;
		}

		const sellable = `(
			product.workflow = :readyWorkflow
			AND (product.available_from IS NULL OR product.available_from <= :now)
			AND (product.available_until IS NULL OR product.available_until > :now)
			AND (product.discontinued_at IS NULL OR product.discontinued_at > :now)
		)`;

		return this.filterRaw(isSellable ? sellable : `NOT ${sellable}`, {
			readyWorkflow: ProductWorkflowEnum.READY,
			now: new Date().toISOString(),
		});
	}
}

export const getProductRepository = () =>
	dataSource.getRepository(ProductEntity).extend({
		createQuery() {
			return new ProductQuery(this);
		},
	});
