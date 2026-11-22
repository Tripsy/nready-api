import type { Request, Response } from 'express';
import ArticleEntity, {
	ArticleVisibilityEnum,
} from '@/features/article/article.entity';
import {
	type ArticleService,
	articleService,
} from '@/features/article/article.service';
import { ArticleValidator } from '@/features/article/article.validator';
import {
	type ArticleAccessPolicy,
	articleAccessPolicy,
} from '@/features/article/article-access.policy';
import ArticleVisibilityRuleRepository, {
	type ArticleVisibilityRuleFields,
} from '@/features/article/article-visibility-rule.repository';
import asyncHandler from '@/helpers/async.handler';
import { getRequestCountry } from '@/helpers/request.helper';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

class ArticlePublicController extends BaseController {
	constructor(
		private validator: ArticleValidator,
		private cache: CacheProvider,
		private articleService: ArticleService,
		private articleAccess: ArticleAccessPolicy,
	) {
		super();
	}

	/**
	 * `res.locals.auth` is still read even though the route is open: `requires_auth` and
	 * `requires_subscription` are evaluated against whoever the caller turns out to be, so an
	 * anonymous route and an authenticated reader are not mutually exclusive here.
	 */
	public read = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.publicRead,
			{
				...req.query,
				slug: req.params.slug,
			},
			res,
		);

		const language = data.language ?? res.locals.language;

		const ref = await this.articleService.resolvePublicRef(
			data.slug,
			language,
		);

		/*
		 * The rule lives under its own key rather than inside the payload, so the response
		 * object can never carry the article's access configuration to the reader being
		 * gated by it. Only restricted articles pay
		 * the extra lookup; the cached half holds no password hash (see the repository).
		 */
		const rule =
			ref.visibility === ArticleVisibilityEnum.RESTRICTED
				? await this.loadVisibilityRule(ref.id)
				: null;

		await this.articleAccess.assertAccess(
			ref,
			res.locals.auth,
			{
				country: getRequestCountry(req),
				password: data.password,
			},
			rule,
		);

		const cacheGetResults = await this.cache.get(
			this.cache.buildKey(
				ArticleEntity.NAME,
				ref.id.toString(),
				language,
				'public-read',
			),
			() => this.articleService.getPublicEntryById(ref.id, language),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});

	/**
	 * Sibling cache key to the payload, so `article:<id>*` invalidation drops both together -
	 * a rule edit goes through `ArticleService`, which cleans that prefix after commit.
	 *
	 * The cast is the cache boundary: `get` returns whatever was deserialized from Redis, and
	 * the loader is the only thing that decides the shape.
	 */
	private async loadVisibilityRule(
		id: EntityId,
	): Promise<ArticleVisibilityRuleFields | null> {
		const results = await this.cache.get(
			this.cache.buildKey(
				ArticleEntity.NAME,
				id.toString(),
				'visibility-rule',
			),
			() => ArticleVisibilityRuleRepository.findFields(id),
		);

		return results.data as ArticleVisibilityRuleFields | null;
	}

	public find = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.publicFind, req.query, res);

		if (!data.filter.language) {
			data.filter.language = res.locals.language;
		}

		const [entries, total] =
			await this.articleService.findByFilterPublic(data);

		res.locals.output.data({
			entries: entries,
			pagination: {
				page: data.page,
				limit: data.limit,
				total: total,
			},
			query: data,
		});

		res.json(res.locals.output);
	});
}

export const articlePublicController = new ArticlePublicController(
	new ArticleValidator('article'),
	cacheProvider,
	articleService,
	articleAccessPolicy,
);
