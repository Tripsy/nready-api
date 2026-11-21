import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { NotAllowedError, UnauthorizedError } from '@/exceptions';
import {
	type ArticleVisibility,
	ArticleVisibilityEnum,
} from '@/features/article/article.entity';
import ArticleVisibilityRuleRepository, {
	type ArticleVisibilityRuleFields,
} from '@/features/article/article-visibility-rule.repository';
import SubscriptionEntity, {
	SubscriptionStatusEnum,
} from '@/features/subscription/subscription.entity';
import { comparePassword } from '@/helpers/security.helper';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { AuthContext } from '@/shared/types/express';

export type ArticleAccessContext = {
	/** ISO 3166-1 alpha-2, or undefined when the deployment cannot determine it */
	country?: string;
	password?: string;
};

export type ArticleAccessTarget = {
	id: EntityId;
	visibility: ArticleVisibility;
};

/**
 * Authorization for the anonymous surface, kept apart from `ArticleService` so the one place
 * that decides whether a visitor may read restricted content stays readable on its own.
 *
 * Deliberately not a `PolicyAbstract` subclass: that base answers "does this role hold this
 * permission" from data already in `res.locals.auth`, synchronously. This one queries the rule
 * row and the reader's subscriptions, so it would not fit the base class without bending it.
 */
export class ArticleAccessPolicy {
	/**
	 * Gate for a public request against an article's visibility rule.
	 *
	 * Every check fails closed: a rule that cannot be evaluated denies rather than allows. The
	 * point of a restriction is that the uncertain case is the one it exists for. `rule` is
	 * therefore required, not optional - a caller that has not loaded it passes `null` and is
	 * denied, rather than skipping the check by omission.
	 *
	 * The rule arrives from the caller because the caller owns the cache; `visibility` must
	 * still come from a fresh read (see `ArticleService.resolvePublicRef`), so that tightening
	 * a restriction cannot be outlived by a cached copy.
	 *
	 * Throws rather than returning a boolean so a caller cannot forget to act on the result.
	 */
	public async assertAccess(
		entry: ArticleAccessTarget,
		auth: AuthContext,
		context: ArticleAccessContext,
		rule: ArticleVisibilityRuleFields | null,
	): Promise<void> {
		if (entry.visibility !== ArticleVisibilityEnum.RESTRICTED) {
			return;
		}

		if (!rule) {
			// Marked restricted with nothing describing the restriction - the safe reading is
			// "restricted", not "public by accident"
			throw new NotAllowedError(lang('article.error.access_restricted'));
		}

		if (rule.requires_auth && auth.id === null) {
			throw new UnauthorizedError(
				lang('article.error.access_requires_auth'),
			);
		}

		if (rule.allowed_countries?.length) {
			if (!context.country) {
				throw new NotAllowedError(
					lang('article.error.access_country_unknown'),
				);
			}

			if (!rule.allowed_countries.includes(context.country)) {
				throw new NotAllowedError(
					lang('article.error.access_country_denied'),
				);
			}
		}

		if (rule.requires_subscription) {
			await this.assertSubscription(auth);
		}

		if (rule.has_password) {
			if (!context.password) {
				throw new NotAllowedError(
					lang('article.error.access_password_required'),
				);
			}

			// The hash is fetched only now, so it never enters the cached copy of the rule.
			// A request that supplies no password is rejected above without reading it
			const hashedPassword =
				await ArticleVisibilityRuleRepository.findPassword(entry.id);

			if (
				!hashedPassword ||
				!(await comparePassword(context.password, hashedPassword))
			) {
				throw new NotAllowedError(
					lang('article.error.invalid_access_password'),
				);
			}
		}
	}

	/**
	 * Proves the reader holds *an* active subscription. The rule carries no plan identifiers:
	 * there is no plan entity to match them against yet (`subscription` hangs off `order`, and
	 * the plan is effectively a `product`), so a per-plan gate would be a list nothing reads.
	 * Add the plan dimension here once plans exist; see the README TODO.
	 */
	private async assertSubscription(auth: AuthContext): Promise<void> {
		if (auth.id === null) {
			throw new UnauthorizedError(
				lang('article.error.access_requires_auth'),
			);
		}

		// TODO later update when subscription feature is implemented
		const count = await dataSource.getRepository(SubscriptionEntity).count({
			where: {
				user_id: auth.id,
				status: SubscriptionStatusEnum.ACTIVE,
			},
		});

		if (count === 0) {
			throw new NotAllowedError(
				lang('article.error.access_requires_subscription'),
			);
		}
	}
}

export const articleAccessPolicy = new ArticleAccessPolicy();
