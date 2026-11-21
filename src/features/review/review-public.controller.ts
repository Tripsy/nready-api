import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import ReviewEntity from '@/features/review/review.entity';
import {
	type ReviewPolicy,
	reviewPolicy,
} from '@/features/review/review.policy';
import {
	type ReviewService,
	reviewService,
} from '@/features/review/review.service';
import { ReviewValidator } from '@/features/review/review.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * The storefront side. No permission is checked - reviewing is what a buyer does - but an account
 * is: `user_id` is `NOT NULL`, so a review has an author by construction, and that account is the
 * identity every write here is scoped to.
 *
 * The reads are open to everyone, signed in or not. `find` carries the caller's own review when
 * there is one, which is the row they may see before a moderator has.
 */
class ReviewPublicController extends BaseController {
	constructor(
		private policy: ReviewPolicy,
		private validator: ReviewValidator,
		private cache: CacheProvider,
		private reviewService: ReviewService,
	) {
		super();
	}

	/** Who the request counts as - 401 for a visitor. */
	private resolveAuthor(res: Response): EntityId {
		return this.policy.requireId(res.locals.auth);
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		const authorId = this.resolveAuthor(res);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.reviewService.create(data, authorId);

		res.locals.output.data(entry);
		res.locals.output.message(lang('review.success.create'));

		res.status(201).json(res.locals.output);
	});

	/**
	 * Revising one's own review. The product comes from the path and addresses the row together
	 * with the caller - `UQ_review_user` allows one live review per buyer per product - so no id
	 * is taken from the request and no ownership check is left to a later step.
	 */
	public update = asyncHandler(async (req: Request, res: Response) => {
		const authorId = this.resolveAuthor(res);

		const data = this.validate(
			this.validator.publicUpdate,
			{ ...req.body, ...req.params },
			res,
		);

		const entry = await this.reviewService.updateOwn(data, authorId);

		res.locals.output.data(entry);
		res.locals.output.message(lang('review.success.update'));

		res.json(res.locals.output);
	});

	/**
	 * Withdrawing a review, and only while it is still pending - once a moderator has decided, the
	 * row is the record that decision was taken against and the author cannot remove it.
	 *
	 * Soft, and withdrawing a pending review frees the slot: `UQ_review_user` is partial on
	 * `deleted_at IS NULL`, so the buyer may write a new one afterward.
	 */
	public delete = asyncHandler(async (req: Request, res: Response) => {
		const authorId = this.resolveAuthor(res);

		const data = this.validate(
			this.validator.publicDelete,
			req.params,
			res,
		);

		await this.reviewService.deleteOwn(data, authorId);

		res.locals.output.message(lang('review.success.delete'));

		res.json(res.locals.output);
	});

	/**
	 * The reviews of one product, plus the caller's own when they hold one - the two halves a
	 * product page renders at once, so they are resolved together rather than over two round
	 * trips. The list is approved rows only; `own` is whatever status the caller's review is in,
	 * which is what decides between offering the form and offering the edit.
	 *
	 * Not cached: it is paginated, filterable and per-caller. The aggregate that every visitor
	 * shares is `summary`, and that one is.
	 */
	public find = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.publicFind,
			{ ...req.query, ...req.params },
			res,
		);

		const [entries, total] =
			await this.reviewService.findByFilterPublic(data);

		const authorId = this.policy.getId(res.locals.auth) || null;

		res.locals.output.data({
			entries: entries,
			own: authorId
				? await this.reviewService.getOwnReview(
						data.product_id,
						authorId,
					)
				: null,
			pagination: {
				page: data.page,
				limit: data.limit,
				total: total,
			},
			query: data,
		});

		res.json(res.locals.output);
	});

	/**
	 * The star widget's numbers. Cached by product rather than by review id: the aggregate belongs
	 * to no single row, and every write that changes it drops this keyspace
	 * (`ReviewService.cleanCaches`).
	 */
	public summary = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.publicSummary,
			req.params,
			res,
		);

		const cacheKey = this.cache.buildKey(
			ReviewEntity.NAME,
			'product',
			data.product_id.toString(),
			'summary',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.reviewService.getSummary(data.product_id),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});
}

export const reviewPublicController = new ReviewPublicController(
	reviewPolicy,
	new ReviewValidator('review'),
	cacheProvider,
	reviewService,
);
