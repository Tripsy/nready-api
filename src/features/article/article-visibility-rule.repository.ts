import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ArticleVisibilityRuleEntity from '@/features/article/article-visibility-rule.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * The rule minus its secret. Everything the gate needs to decide, except the password itself:
 * `has_password` says whether one is required, and the hash is read separately by whoever is
 * actually comparing against it.
 *
 * Split this way so the cached copy of a rule never carries a credential.
 */
export type ArticleVisibilityRuleFields = {
	requires_auth: boolean;
	requires_subscription: boolean;
	allowed_countries: string[] | null;
	is_listed: boolean;
	has_password: boolean;
};

export class ArticleVisibilityRuleQuery extends RepositoryAbstract<ArticleVisibilityRuleEntity> {
	constructor(repository: Repository<ArticleVisibilityRuleEntity>) {
		super(repository, ArticleVisibilityRuleEntity.NAME);
	}
}

export const ArticleVisibilityRuleRepository = dataSource
	.getRepository(ArticleVisibilityRuleEntity)
	.extend({
		createQuery() {
			return new ArticleVisibilityRuleQuery(this);
		},

		/**
		 * Cacheable half of the rule. Returns null when the article has no rule row - which the
		 * gate must read as "restricted", not as "unrestricted".
		 */
		async findFields(
			article_id: EntityId,
		): Promise<ArticleVisibilityRuleFields | null> {
			const entry = await this.createQuery()
				.select([
					'article_visibility_rule.requires_auth',
					'article_visibility_rule.requires_subscription',
					'article_visibility_rule.allowed_countries',
					'article_visibility_rule.is_listed',
					'article_visibility_rule.password',
				])
				.filterBy('article_visibility_rule.article_id', article_id)
				.first();

			if (!entry) {
				return null;
			}

			return {
				requires_auth: entry.requires_auth,
				requires_subscription: entry.requires_subscription,
				allowed_countries: entry.allowed_countries,
				is_listed: entry.is_listed,
				// The hash itself is dropped here - only its presence travels
				has_password: entry.password !== null,
			};
		},

		/**
		 * Read on demand, never cached: a password attempt is a small slice of traffic and
		 * already pays for a bcrypt compare, so there is no reason to keep a credential hash
		 * in Redis for the requests that never supply one.
		 */
		async findPassword(article_id: EntityId): Promise<string | null> {
			const entry = await this.createQuery()
				.select(['article_visibility_rule.password'])
				.filterBy('article_visibility_rule.article_id', article_id)
				.first();

			return entry?.password ?? null;
		},
	});

export default ArticleVisibilityRuleRepository;
