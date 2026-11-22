import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ProductCategoryEntity from '@/features/product/product-category.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ProductCategoryQuery extends RepositoryAbstract<ProductCategoryEntity> {
	constructor(repository: Repository<ProductCategoryEntity>) {
		super(repository, ProductCategoryEntity.NAME);
	}
}

export const ProductCategoryRepository = dataSource
	.getRepository(ProductCategoryEntity)
	.extend({
		createQuery() {
			return new ProductCategoryQuery(this);
		},

		/**
		 * The unique index is partial on `deleted_at IS NULL`, so an unlinked row keeps its
		 * slot: relinking the same category restores the row it had rather than inserting a
		 * second one that would collide the moment either is undeleted.
		 */
		async syncLinks(
			manager: EntityManager,
			product_id: EntityId,
			categoryIds: EntityId[],
		): Promise<void> {
			const repository = manager.getRepository(ProductCategoryEntity);

			const existing = await repository.find({
				where: { product_id },
				withDeleted: true,
			});

			const wanted = new Set(categoryIds);
			const known = new Set(existing.map((link) => link.category_id));

			const toRemove = existing.filter(
				(link) =>
					link.deleted_at === null && !wanted.has(link.category_id),
			);
			const toRestore = existing.filter(
				(link) =>
					link.deleted_at !== null && wanted.has(link.category_id),
			);
			const toInsert = categoryIds.filter(
				(category_id) => !known.has(category_id),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			if (toRestore.length > 0) {
				await repository.recover(toRestore);
			}

			if (toInsert.length > 0) {
				await repository.save(
					toInsert.map((category_id) =>
						repository.create({ product_id, category_id }),
					),
				);
			}
		},
	});

export default ProductCategoryRepository;
