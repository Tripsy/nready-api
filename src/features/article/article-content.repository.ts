import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type { ArticleContentType } from '@/features/article/article.validator';
import ArticleContentEntity from '@/features/article/article-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ArticleContentQuery extends RepositoryAbstract<ArticleContentEntity> {
	constructor(repository: Repository<ArticleContentEntity>) {
		super(repository, ArticleContentEntity.NAME);
	}
}

export const ArticleContentRepository = dataSource
	.getRepository(ArticleContentEntity)
	.extend({
		createQuery() {
			return new ArticleContentQuery(this);
		},

		async saveContent(
			manager: EntityManager,
			contents: ArticleContentType[],
			article_id: EntityId,
		) {
			if (!contents.length) {
				return;
			}

			await manager
				.createQueryBuilder()
				.insert()
				.into(ArticleContentEntity)
				.values(
					contents.map((content) => ({
						article_id: article_id,
						language: content.language,
						slug: content.slug,
						title: content.title,
						brief: content.brief,
						content: content.content,
						author: content.author,
						meta: content.meta,
					})),
				)
				.orUpdate(
					['slug', 'title', 'brief', 'content', 'author', 'meta'],
					['article_id', 'language'],
				)
				.execute();
		},

		/**
		 * The (slug, language) unique index is global, so a duplicate is a
		 * conflict with another article rather than a re-save of this one.
		 */
		async findConflictingSlug(
			contents: ArticleContentType[],
			article_id?: EntityId,
		): Promise<ArticleContentEntity | null> {
			if (!contents.length) {
				return null;
			}

			// Filtered on slug alone and paired up in memory: the slug carries the
			// selectivity, and one index scan beats a per-language OR chain
			// Columns are left unprefixed so the query builder resolves them against
			// its own alias - `article_content`, not the `content` join alias the
			// article queries use
			const query = this.createQuery()
				.select(['id', 'slug', 'language'])
				.filterBy(
					'slug',
					contents.map((content) => content.slug),
					'IN',
				);

			if (article_id) {
				query.filterBy('article_id', article_id, '!=');
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

export default ArticleContentRepository;
