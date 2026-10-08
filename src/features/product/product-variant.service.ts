import { productService } from '@/features/product/product.service';
import ProductVariantRepository from '@/features/product/product-variant.repository';
import type { ProductVariantValidator } from '@/features/product/product-variant.validator';
import { OrderByEnum } from '@/features/product/product-variant.validator';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * The catalog listing, one row per sellable unit.
 *
 * A second module rather than a widened `ProductService.findByFilter`: that query pins
 * `variant.is_default = true` to stop rows multiplying, and `getManyAndCount` with skip/take
 * resolves the page as a distinct **product-id** subquery first. Loosening the join there cannot
 * produce variant-paged results - `limit: 20` would return twenty *products'* worth of variants.
 * Rooting the query on `product_variant` is what makes the page count variants.
 */
class ProductVariantService {
	private repository = ProductVariantRepository;

	/**
	 * `label` and `brand` name the joined translation and brand rows rather than columns on
	 * `product_variant`. Mapped here rather than stated that way in `OrderByEnum`, so a join
	 * alias never becomes part of the API contract.
	 *
	 * Both joins are LEFT, so a variant whose product carries no translation in the requested
	 * language, or no brand, sorts last rather than disappearing.
	 */
	private resolveOrderBy(orderBy: string): string {
		if (orderBy === OrderByEnum.LABEL) {
			return 'content.label';
		}

		if (orderBy === OrderByEnum.BRAND) {
			return 'brand.name';
		}

		return `product_variant.${orderBy}`;
	}

	public async findByFilter(
		data: ValidatorOutput<ProductVariantValidator, 'find'>,
		withDeleted: boolean,
	) {
		const showDeleted = withDeleted && data.filter.is_deleted;

		const query = this.repository
			.createQuery()
			/*
			 * Before the joins, and that ordering is load-bearing. TypeORM appends a joined
			 * relation's `deleted_at IS NULL` to the ON clause inside `join()` itself, reading
			 * `withDeleted` as it stands at that moment - so calling this afterwards lifts the
			 * condition on the root row and leaves every join still filtering. Soft-deleting a
			 * product does not cascade to its variants (no cascade on the `@OneToMany`, and
			 * `ProductService.delete` only touches the product row), so with the call at the end
			 * of the chain the INNER join silently hid exactly the rows "show deleted" is asked
			 * for: the listing returned nothing for a deleted product. Verified against the
			 * generated SQL, not inferred.
			 */
			.withDeleted(showDeleted)
			.join('product_variant.product', 'product', 'INNER')
			.join(
				'product.contents',
				'content',
				'LEFT',
				'content.language = :language',
				{ language: data.filter.language },
			)
			.join('product.brand', 'brand', 'LEFT')
			.join(
				'product_variant.prices',
				'price',
				'LEFT',
				'price.deleted_at IS NULL',
			)
			.select([
				'product_variant.id',
				'product_variant.product_id',
				'product_variant.sku',
				'product_variant.barcode',
				'product_variant.position',
				'product_variant.is_default',
				'product_variant.track_stock',
				'product_variant.low_stock_threshold',
				'product_variant.allow_backorder',
				'product_variant.cost_price',
				'product_variant.created_at',
				'product_variant.updated_at',
				'product_variant.deleted_at',

				'product.id',
				'product.workflow',
				'product.sale_status',
				'product.type',
				'product.composition',
				'product.unit',
				'product.vat_category',
				'product.brand_id',
				'product.deleted_at',

				'content.language',
				'content.slug',
				'content.label',

				'brand.id',
				'brand.name',

				'price.id',
				'price.currency',
				'price.sale_price',
				// The floor a discount stops at, for the order editor to warn before a save
				'price.min_price',
			])
			.filterById(data.filter.id)
			.filterBy('product_variant.product_id', data.filter.product_id)
			.filterBy('product.workflow', data.filter.workflow)
			.filterBy('product.type', data.filter.type)
			.filterBy('product.composition', data.filter.composition)
			.filterBy('product.brand_id', data.filter.brand_id)
			.filterByTerm(data.filter.term)
			.filterBySellable(data.filter.is_sellable);

		/*
		 * Joined inside the branch rather than alongside the rest: on a variant root these two
		 * only multiply rows, and neither is selected - the listing shows a product's brand and
		 * translation, not its whole category set.
		 */
		if (data.filter.category_id) {
			query
				.join('product.categories', 'category_filter', 'INNER')
				.filterRaw('category_filter.category_id IN (:...categoryIds)', {
					categoryIds: await productService.resolveCategorySubtree(
						data.filter.category_id,
					),
				});
		}

		if (data.filter.tag_id) {
			query
				.join('product.tags', 'tag', 'INNER')
				.filterBy('tag.tag_id', data.filter.tag_id);
		}

		return query
			.orderBy(this.resolveOrderBy(data.order_by), data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const productVariantService = new ProductVariantService();
export type { ProductVariantService };
