import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import { ProductWorkflowEnum } from '@/features/product/product.entity';
import type {
	ProductPriceType,
	ProductVariantType,
} from '@/features/product/product.validator';
import type { ResolvedAttributeValue } from '@/features/product/product-attribute.repository';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ProductVariantAttributeEntity from '@/features/product/product-variant-attribute.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * A payload variant whose attribute values already carry their normalized `value_base`.
 *
 * `attributes` stays optional through the resolution: absent means the payload said nothing about
 * the axis values and the stored ones are kept, which `syncVariants` cannot tell from `[]` once
 * the key is filled in.
 */
export type ResolvedVariant = Omit<ProductVariantType, 'attributes'> & {
	attributes?: ResolvedAttributeValue[];
};

export class ProductVariantQuery extends RepositoryAbstract<ProductVariantEntity> {
	constructor(repository: Repository<ProductVariantEntity>) {
		super(repository, ProductVariantEntity.NAME);
	}

	/**
	 * A numeric term is an id lookup; anything else searches the code and the translation.
	 *
	 * Rooted on the variant, so the code branch compares `product_variant.sku` directly.
	 * `ProductQuery.filterByTerm` needs an `EXISTS` subquery for the same thing only because the
	 * alias its listings join is pinned to the default variant. The predicate must stay spelled
	 * `lower(sku) LIKE lower(:term)`: `IDX_product_variant_sku_prefix` is built over
	 * `lower("sku") text_pattern_ops`, and an `ILIKE` cannot seek on it - it reverts to a
	 * sequential scan with nothing reported.
	 *
	 * The translation branch requires the caller to have joined the `content` alias, and its
	 * expression must stay character-identical to the GIN index in
	 * `1788300000000-product-content-search.ts`, down to the `COALESCE` and the `'simple'`
	 * configuration. Postgres only uses an expression index when the query repeats it verbatim.
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
				OR lower(product_variant.sku) LIKE lower(:skuTerm)
			)`,
			{ term: tsTerm, skuTerm: `${term.trim()}%` },
		);
	}

	/**
	 * The sellable window of the variant's product - the same rule as `ProductQuery`, read across
	 * the join: the product is published (`workflow = ready`), past its opening date, inside its
	 * selling window and not withdrawn.
	 *
	 * The two have to stay identical, or a variant listing and a product listing disagree about
	 * what is on sale. See `ProductQuery.filterBySellable` for why the deadlines are compared
	 * directly rather than read off `sale_status`, for why `workflow` is checked separately, and
	 * for why the filter is tri-state and negates the predicate whole.
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

/**
 * Prices and axis values are synced together with the variant they belong to: all three tables
 * key on it, and a variant saved without its price is a thing that cannot be sold.
 */
export const ProductVariantRepository = dataSource
	.getRepository(ProductVariantEntity)
	.extend({
		createQuery() {
			return new ProductVariantQuery(this);
		},

		/**
		 * Replaces the product's variants with the set the payload states, matching on `sku` -
		 * the natural key, and the only stable identifier a form can round-trip.
		 *
		 * Soft-deleted variants are read alongside the live ones and revived when their SKU
		 * comes back: the unique index on `sku` is partial on `deleted_at IS NULL`, so inserting
		 * a second row with the same code would collide the moment either is restored. It also
		 * keeps the order lines and stock movements that point at the old id attached to the
		 * variant they were written against.
		 *
		 * A withdrawn variant is soft-deleted, never removed. `product_bundle_item.variant_id`
		 * is a RESTRICT foreign key, so a hard delete of a variant some bundle still names would
		 * fail at the database and reach the client as a masked 500.
		 */
		async syncVariants(
			manager: EntityManager,
			product_id: EntityId,
			variants: ResolvedVariant[],
		): Promise<void> {
			const repository = manager.getRepository(ProductVariantEntity);

			const existing = await repository.find({
				where: { product_id },
				withDeleted: true,
			});

			const wanted = new Map(
				variants.map((variant) => [variant.sku, variant]),
			);
			const known = new Map(existing.map((row) => [row.sku, row]));

			const toRemove = existing.filter(
				(row) => row.deleted_at === null && !wanted.has(row.sku),
			);

			/*
			 * The default flag is cleared before anything is written, because the partial
			 * unique index allows one `is_default` per product and a save that sets the new
			 * default before clearing the old one collides with it. Two statements rather than
			 * a reorder of the loop: which row *was* default is not knowable from the payload.
			 */
			if (existing.length > 0) {
				await repository.update(
					{ product_id, is_default: true },
					{ is_default: false },
				);
			}

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			for (const [sku, variant] of wanted) {
				const row =
					known.get(sku) ?? repository.create({ product_id, sku });

				row.deleted_at = null;
				row.barcode = variant.barcode ?? null;
				row.position = variant.position ?? 0;
				row.is_default = variant.is_default ?? false;
				row.track_stock = variant.track_stock ?? false;
				row.low_stock_threshold = variant.low_stock_threshold ?? null;
				row.allow_backorder = variant.allow_backorder ?? false;
				row.cost_price = variant.cost_price ?? null;

				const saved = await repository.save(row);

				await this.syncPrices(manager, saved.id, variant.prices);

				if (variant.attributes) {
					await this.syncAttributes(
						manager,
						saved.id,
						variant.attributes,
					);
				}
			}
		},

		/** One price row per currency, keyed the way the table's unique index is. */
		async syncPrices(
			manager: EntityManager,
			variant_id: EntityId,
			prices: ProductPriceType[],
		): Promise<void> {
			const repository = manager.getRepository(ProductPriceEntity);

			const existing = await repository.find({
				where: { variant_id },
				withDeleted: true,
			});

			const wanted = new Map(
				prices.map((price) => [price.currency, price]),
			);
			const known = new Map(existing.map((row) => [row.currency, row]));

			const toRemove = existing.filter(
				(row) => row.deleted_at === null && !wanted.has(row.currency),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			const toSave: ProductPriceEntity[] = [];

			for (const [currency, price] of wanted) {
				const row =
					known.get(currency) ??
					repository.create({ variant_id, currency });

				row.deleted_at = null;
				row.sale_price = price.sale_price;
				row.reference_price = price.reference_price ?? null;
				row.min_price = price.min_price ?? null;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},

		/**
		 * One value per axis, matching the table's unique key - which stops at the label,
		 * unlike `product_attribute`'s. A variant cannot be both `large` and `small`.
		 */
		async syncAttributes(
			manager: EntityManager,
			variant_id: EntityId,
			values: ResolvedAttributeValue[],
		): Promise<void> {
			const repository = manager.getRepository(
				ProductVariantAttributeEntity,
			);

			const existing = await repository.find({
				where: { variant_id },
				withDeleted: true,
			});

			const wanted = new Map(
				values.map((value) => [value.attribute_label_id, value]),
			);
			const known = new Map(
				existing.map((row) => [row.attribute_label_id, row]),
			);

			const toRemove = existing.filter(
				(row) =>
					row.deleted_at === null &&
					!wanted.has(row.attribute_label_id),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			const toSave: ProductVariantAttributeEntity[] = [];

			for (const [attribute_label_id, value] of wanted) {
				const row =
					known.get(attribute_label_id) ??
					repository.create({ variant_id, attribute_label_id });

				row.deleted_at = null;
				row.value_term_id = value.value_term_id ?? null;
				row.value_numeric = value.value_numeric ?? null;
				row.value_base = value.value_base;
				row.value_text = value.value_text ?? null;
				row.value_boolean = value.value_boolean ?? null;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},
	});

export default ProductVariantRepository;
