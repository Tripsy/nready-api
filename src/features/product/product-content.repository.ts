import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type { ProductContentType } from '@/features/product/product.validator';
import ProductContentEntity from '@/features/product/product-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ProductContentQuery extends RepositoryAbstract<ProductContentEntity> {
	constructor(repository: Repository<ProductContentEntity>) {
		super(repository, ProductContentEntity.NAME);
	}
}

export const ProductContentRepository = dataSource
	.getRepository(ProductContentEntity)
	.extend({
		createQuery() {
			return new ProductContentQuery(this);
		},

		async saveContent(
			manager: EntityManager,
			contents: ProductContentType[],
			product_id: EntityId,
		) {
			if (!contents.length) {
				return;
			}

			await manager
				.createQueryBuilder()
				.insert()
				.into(ProductContentEntity)
				.values(
					contents.map((content) => ({
						product_id: product_id,
						language: content.language,
						slug: content.slug,
						label: content.label,
						description: content.description,
						meta: content.meta,
					})),
				)
				.orUpdate(
					['slug', 'label', 'description', 'meta'],
					['product_id', 'language'],
				)
				.execute();
		},

		/**
		 * The (slug, language) unique index is global, so a duplicate is a conflict with
		 * another product rather than a re-save of this one.
		 */
		async findConflictingSlug(
			contents: ProductContentType[],
			product_id?: EntityId,
		): Promise<ProductContentEntity | null> {
			if (!contents.length) {
				return null;
			}

			// Filtered on slug alone and paired up in memory: the slug carries the
			// selectivity, and one index scan beats a per-language OR chain.
			// Columns are left unprefixed so the query builder resolves them against its
			// own alias - `product_content`, not the `content` join alias the product
			// queries use
			const query = this.createQuery()
				.select(['id', 'slug', 'language'])
				.filterBy(
					'slug',
					contents.map((content) => content.slug),
					'IN',
				);

			if (product_id) {
				query.filterBy('product_id', product_id, '!=');
			}

			const candidates = await query.all();

			const requested = new Set(
				contents.map(
					(content) => `${content.slug}:${content.language}`,
				),
			);

			return (
				candidates.find((candidate) =>
					requested.has(`${candidate.slug}:${candidate.language}`),
				) ?? null
			);
		},
	});

export default ProductContentRepository;
