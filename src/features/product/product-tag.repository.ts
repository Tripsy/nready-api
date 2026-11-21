import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ProductTagEntity from '@/features/product/product-tag.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ProductTagQuery extends RepositoryAbstract<ProductTagEntity> {
	constructor(repository: Repository<ProductTagEntity>) {
		super(repository, ProductTagEntity.NAME);
	}
}

export const ProductTagRepository = dataSource
	.getRepository(ProductTagEntity)
	.extend({
		createQuery() {
			return new ProductTagQuery(this);
		},

		async syncLinks(
			manager: EntityManager,
			product_id: EntityId,
			tagIds: EntityId[],
		): Promise<void> {
			const repository = manager.getRepository(ProductTagEntity);

			const existing = await repository.find({
				where: { product_id },
				withDeleted: true,
			});

			const wanted = new Set(tagIds);
			const known = new Set(existing.map((link) => link.tag_id));

			const toRemove = existing.filter(
				(link) => link.deleted_at === null && !wanted.has(link.tag_id),
			);
			const toRestore = existing.filter(
				(link) => link.deleted_at !== null && wanted.has(link.tag_id),
			);
			const toInsert = tagIds.filter((tag_id) => !known.has(tag_id));

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			if (toRestore.length > 0) {
				await repository.recover(toRestore);
			}

			if (toInsert.length > 0) {
				await repository.save(
					toInsert.map((tag_id) =>
						repository.create({ product_id, tag_id }),
					),
				);
			}
		},
	});

export default ProductTagRepository;
