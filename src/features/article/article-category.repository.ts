import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ArticleCategoryEntity from '@/features/article/article-category.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ArticleCategoryQuery extends RepositoryAbstract<ArticleCategoryEntity> {
	constructor(repository: Repository<ArticleCategoryEntity>) {
		super(repository, ArticleCategoryEntity.NAME);
	}
}

export const ArticleCategoryRepository = dataSource
	.getRepository(ArticleCategoryEntity)
	.extend({
		createQuery() {
			return new ArticleCategoryQuery(this);
		},

		async syncLinks(
			manager: EntityManager,
			article_id: EntityId,
			categoryIds: EntityId[],
		): Promise<void> {
			const repository = manager.getRepository(ArticleCategoryEntity);

			const existing = await repository.find({
				where: { article_id },
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
						repository.create({ article_id, category_id }),
					),
				);
			}
		},
	});

export default ArticleCategoryRepository;
