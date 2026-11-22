import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ArticleTagEntity from '@/features/article/article-tag.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ArticleTagQuery extends RepositoryAbstract<ArticleTagEntity> {
	constructor(repository: Repository<ArticleTagEntity>) {
		super(repository, ArticleTagEntity.NAME);
	}
}

export const ArticleTagRepository = dataSource
	.getRepository(ArticleTagEntity)
	.extend({
		createQuery() {
			return new ArticleTagQuery(this);
		},

		async syncLinks(
			manager: EntityManager,
			article_id: EntityId,
			tagIds: EntityId[],
		): Promise<void> {
			const repository = manager.getRepository(ArticleTagEntity);

			const existing = await repository.find({
				where: { article_id },
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
						repository.create({ article_id, tag_id }),
					),
				);
			}
		},
	});

export default ArticleTagRepository;
