import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import ArticleEntity, {
	ArticleStatusEnum,
} from '@/features/article/article.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ArticleQuery extends RepositoryAbstract<ArticleEntity> {
	constructor(repository: Repository<ArticleEntity>) {
		super(repository, ArticleEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				const tsTerm = this.prepareTsTerm(term);

				if (tsTerm !== '') {
					this.filterRaw(
						`to_tsvector('simple', COALESCE(content.title, '') || ' ' || COALESCE(content.brief, '')) @@ to_tsquery('simple', :term || ':*')`,
						{ term: tsTerm },
					);
				}
			}
		}

		return this;
	}

	/**
	 * The display window: published, released, and not yet due for archiving. `archive_at` is
	 * also enforced by a cron job, so this only covers the gap between the deadline passing and
	 * the next run - without it an article stays visible for as long as that gap lasts.
	 */
	filterPublished(isPublished?: boolean): this {
		if (isPublished) {
			this.filterBy('article.status', ArticleStatusEnum.PUBLISHED);
			this.filterRaw(
				'(article.publish_at IS NULL OR article.publish_at <= :now) AND (article.archive_at IS NULL OR article.archive_at > :now)',
				{ now: new Date().toISOString() },
			);
		}

		return this;
	}
}

export const getArticleRepository = () =>
	dataSource.getRepository(ArticleEntity).extend({
		createQuery() {
			return new ArticleQuery(this);
		},
	});
