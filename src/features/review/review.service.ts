import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import {
	type OrderService,
	orderService,
} from '@/features/order/order.service';
import { productService } from '@/features/product/product.service';
import { ProductVariantRepository } from '@/features/product/product-variant.repository';
import ReviewEntity, {
	REVIEW_RATING_DIMENSIONS,
	type ReviewRating,
	type ReviewRatingDimension,
	type ReviewStatus,
	ReviewStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/review/review.entity';
import { getReviewRepository } from '@/features/review/review.repository';
import {
	paramsUpdateList,
	type ReviewValidator,
} from '@/features/review/review.validator';
import { createCurrentDate } from '@/helpers/date.helper';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheBy,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * The statuses an author may still act on their own review from - revising it or withdrawing it.
 * Only `pending` qualifies: until a moderator has read it, the text is nobody's decision but the
 * author's.
 *
 * Every other status is a decision already taken, and the row is the record it was taken against.
 * Allowing an edit after `approved` would let a passed review be rewritten into text no moderator
 * read; allowing a withdrawal after `rejected` or `spam` would hand the author a way around the
 * decision, since `UQ_review_user` is partial on `deleted_at IS NULL` and a withdrawn review frees
 * the slot for a fresh one.
 */
const OWNER_EDITABLE_STATUSES: readonly ReviewStatus[] = [
	ReviewStatusEnum.PENDING,
];

/** The columns a public read returns. The moderation trail is never among them. */
const PUBLIC_COLUMNS: string[] = [
	'review.id',
	'review.product_id',
	'review.variant_id',
	'review.rating',
	'review.rating_avg',
	'review.content',
	'review.is_pinned',
	'review.is_verified',
	'review.user_id',
	'review.created_at',
	'review.updated_at',
];

/** How many reviews stand behind a product's average, and how they are spread. */
export type ReviewSummary = {
	total: number;
	average: number;
	/** How many reviews carry each whole star, keyed 1-5; absent scores are absent keys. */
	distribution: Record<number, number>;
	/** The average per dimension, over the reviews that scored it. */
	dimensions: Partial<Record<ReviewRatingDimension, number>>;
};

/** One `ROUND(rating_avg)` group of the distribution query. */
type ReviewDistributionRow = {
	stars: string;
	count: string;
};

export class ReviewService {
	constructor(
		private repository: ReturnType<typeof getReviewRepository>,
		private orderService: OrderService,
	) {}

	/**
	 * The scores that were given, summed and divided by how many were given - never by how many
	 * dimensions exist, which would score a partly-filled review as though the blanks were zeros.
	 *
	 * Rounded to the column's two decimals here rather than left to Postgres, so the value this
	 * service compares and returns is the value the row holds: (5 + 4 + 4) / 3 stores as 4.33.
	 */
	public static computeRatingAvg(rating: ReviewRating): number {
		const scores = REVIEW_RATING_DIMENSIONS.map(
			(dimension) => rating[dimension],
		).filter((score): score is number => typeof score === 'number');

		if (scores.length === 0) {
			// `CHK_review_rating` refuses such a row and the validator refuses the payload before
			// that; reaching here means a caller inside this codebase built one by hand.
			throw new BadRequestError(lang('review.error.rating_empty'));
		}

		const total = scores.reduce((sum, score) => sum + score, 0);

		return Math.round((total / scores.length) * 100) / 100;
	}

	/**
	 * Both halves of what a review points at, before anything is written.
	 *
	 * The two foreign keys would answer this on their own, but only as a constraint violation -
	 * a masked 500 rather than the 404 the product is missing and the 400 the variant belongs to
	 * a different product deserve. `findById` raises the product's own not-found error.
	 */
	private async assertTarget(
		productId: number,
		variantId?: number | null,
	): Promise<void> {
		await productService.findById(productId, false);

		if (!variantId) {
			return;
		}

		const variant = await ProductVariantRepository.createQuery()
			.select(['product_variant.id'])
			.filterById(variantId)
			.filterBy('product_id', productId)
			.first();

		if (!variant) {
			throw new BadRequestError(lang('review.error.invalid_variant'));
		}
	}

	/**
	 * @description Used in `create` method from the public controller
	 *
	 * Lands `pending` whoever writes it. Unlike a comment, a review is a lasting claim about
	 * something being sold, printed next to it and averaged into its score - so the one thing that
	 * could not be undone afterwards, publishing it, is not done first.
	 *
	 * Strictly an insert: a buyer who already holds a review on this product is told so and
	 * revises it through `updateOwn`. An upsert would silently rewrite a review a moderator has
	 * already passed.
	 */
	public async create(
		data: ValidatorOutput<ReviewValidator, 'create'>,
		userId: number,
	): Promise<ReviewEntity> {
		await this.assertTarget(data.product_id, data.variant_id);

		/*
		 * The purchase is settled here, in the same write, rather than by a later sweep - the flag
		 * is part of what the row says about itself. `order_id` is derived, never taken from the
		 * payload: a caller naming an order would be claiming somebody else's purchase.
		 *
		 * Finding no purchase leaves `is_verified` false, not refused: a phone order or a
		 * marketplace sale is invisible to this lookup, and the dashboard checkbox is what covers
		 * it. Nothing here ever clears a flag a moderator set.
		 */
		const orderId = await this.orderService.findLatestPurchase(
			userId,
			data.product_id,
			data.variant_id,
		);

		try {
			const entry = await this.repository.save(
				this.repository.create({
					product_id: data.product_id,
					variant_id: data.variant_id ?? null,
					order_id: orderId,
					is_verified: orderId !== null,
					rating: data.rating,
					rating_avg: ReviewService.computeRatingAvg(data.rating),
					content: data.content,
					status: ReviewStatusEnum.PENDING,
					user_id: userId,
				}),
			);

			return entry;
		} catch (error) {
			throw ReviewService.asConflict(error);
		}
	}

	/**
	 * `UQ_review_user` is the only unique an insert here can collide on, and it says the caller
	 * already reviewed this product - an action they can take something about, so it is a 409 with
	 * a message rather than a masked 500.
	 *
	 * Anything that is not a unique violation is returned untouched, so the original error keeps
	 * its stack and reaches the error handler as itself.
	 */
	private static asConflict(error: unknown): unknown {
		if (!RepositoryAbstract.isUniqueViolation(error)) {
			return error;
		}

		return new CustomError(409, lang('review.error.already_reviewed'));
	}

	/**
	 * @description Used in `update` method from the public controller
	 *
	 * Addressed by product plus the account resolved from the request, never by id, so the row this
	 * resolves to is by construction the caller's own and no ownership check is left to a later
	 * step. A product the caller never reviewed answers 404 - the same answer somebody else's
	 * review gives, so a caller learns nothing about rows they cannot see. A review a moderator has
	 * decided on answers 403; only `pending` is still the author's to change.
	 *
	 * `rating_avg` is recomputed whenever the scores move: it is denormalized, and every average
	 * and star filter reads it instead of the jsonb.
	 */
	public async updateOwn(
		data: ValidatorOutput<ReviewValidator, 'publicUpdate'>,
		userId: number,
	): Promise<ReviewEntity> {
		const entry = await this.repository
			.createQuery()
			.filterBy('product_id', data.product_id)
			.filterBy('user_id', userId)
			.firstOrFail();

		if (!OWNER_EDITABLE_STATUSES.includes(entry.status)) {
			throw new CustomError(403, lang('review.error.not_editable'));
		}

		const rating = data.rating;

		if (rating) {
			entry.rating = rating;
			entry.rating_avg = ReviewService.computeRatingAvg(rating);
		}

		if (data.content !== undefined) {
			entry.content = data.content;
		}

		const saved = await this.repository.save(entry);

		await this.cleanCaches(saved);

		return saved;
	}

	/**
	 * @description Used in `delete` method from the public controller
	 *
	 * Only while the review is still `pending`, for the reason `OWNER_EDITABLE_STATUSES` carries:
	 * the delete is soft and `UQ_review_user` is partial on `deleted_at IS NULL`, so withdrawing
	 * frees the slot - which after a decision would be a way to write a fresh review in place of
	 * one that was approved, rejected or marked as spam.
	 *
	 * Withdrawing a pending review does free the slot, and that is intended: nobody has read it.
	 */
	public async deleteOwn(
		data: ValidatorOutput<ReviewValidator, 'publicDelete'>,
		userId: number,
	): Promise<void> {
		const entry = await this.repository
			.createQuery()
			.filterBy('product_id', data.product_id)
			.filterBy('user_id', userId)
			.firstOrFail();

		if (!OWNER_EDITABLE_STATUSES.includes(entry.status)) {
			throw new CustomError(403, lang('review.error.not_withdrawable'));
		}

		await this.repository.createQuery().filterById(entry.id).delete();

		await this.cleanCaches(entry);
	}

	/**
	 * @description Used in `update` method from the dashboard controller
	 *
	 * Only the presentation of a review is editable here - its text, whether it sits at the top of
	 * the list, whether the buyer is marked as verified. The moderation decision itself moves
	 * through `updateStatus`, which is the only place `STATUS_TRANSITIONS` is honored.
	 */
	public async updateData(
		entry: ReviewEntity,
		data: ValidatorOutput<ReviewValidator, 'update'>,
	): Promise<ReviewEntity> {
		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		const saved = await this.repository.save(entry);

		await this.cleanCaches(saved);

		return saved;
	}

	/**
	 * @description Used in `statusUpdate` method from the dashboard controller
	 *
	 * The moderation trail is written with the decision, in the same save: who decided, when, and
	 * why. `moderation_reason` is overwritten on every decision rather than appended to - it
	 * describes the state the review is in now, and the history of how it got there is what
	 * `log_history` keeps.
	 *
	 * `moderatedBy` is nullable because the column is: the caller is always authenticated here, but
	 * a decision taken by a background sweep has no user to name, and forcing one would mean
	 * inventing it.
	 */
	public async updateStatus(
		entry: ReviewEntity,
		newStatus: ReviewStatus,
		moderatedBy: number | null,
		moderationReason?: string,
	): Promise<ReviewEntity> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;
		entry.moderated_at = createCurrentDate();
		entry.moderated_by = moderatedBy;
		entry.moderation_reason = moderationReason ?? null;

		const saved = await this.repository.save(entry);

		await this.cleanCaches(saved);

		return saved;
	}

	/**
	 * @description Used in `delete` method from the dashboard controller
	 */
	public async delete(id: number): Promise<void> {
		const entry = await this.findById(id, false);

		await this.repository.createQuery().filterById(id).delete();

		await this.cleanCaches(entry);
	}

	/**
	 * @description Used in `restore` method from the dashboard controller
	 *
	 * `UQ_review_user` is partial on `deleted_at IS NULL`, so deleting a review releases its slot
	 * straight away and the same buyer may write another one on that product. Restoring the first
	 * then collides, and without this check the collision surfaces from the database as a masked
	 * 500 instead of the 409 `create` already answers with.
	 */
	public async restore(id: number): Promise<void> {
		const entry = await this.findById(id, true);

		const existing = await this.repository
			.createQuery()
			.filterBy('product_id', entry.product_id)
			.filterBy('user_id', entry.user_id)
			.filterBy('id', entry.id, '!=')
			.first();

		if (existing) {
			throw new CustomError(409, lang('review.error.already_reviewed'));
		}

		await this.repository.createQuery().filterById(id).restore();

		await this.cleanCaches(entry);
	}

	public findById(id: number, withDeleted: boolean): Promise<ReviewEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `read` method from the dashboard controller
	 */
	public getEntryData(data: {
		id: number;
		withDeleted: boolean;
	}): Promise<ReviewEntity> {
		return (
			this.repository
				.createQuery()
				.join('review.user', 'user', 'LEFT')
				.join('review.variant', 'variant', 'LEFT')
				// The account that took the last decision, so the window can name the moderator
				// rather than print an id. The relation carries no foreign key, so a deleted account
				// leaves the id behind and this simply joins nothing - see the entity.
				.join('review.moderator', 'moderator', 'LEFT')
				.select([
					'review.id',
					'review.product_id',
					'review.variant_id',
					'review.order_id',
					'review.rating',
					'review.rating_avg',
					'review.content',
					'review.status',
					'review.is_pinned',
					'review.is_verified',
					'review.user_id',
					'review.moderated_at',
					'review.moderated_by',
					'review.moderation_reason',
					'review.created_at',
					'review.updated_at',
					'review.deleted_at',

					'user.id',
					'user.name',
					'user.email',

					'variant.id',
					'variant.sku',

					'moderator.id',
					'moderator.name',
				])
				.filterById(data.id)
				.withDeleted(data.withDeleted)
				.firstOrFail()
		);
	}

	/**
	 * @description Used in `find` method from the dashboard controller
	 */
	public findByFilter(
		data: ValidatorOutput<ReviewValidator, 'find'>,
		withDeleted: boolean,
		language: string,
	) {
		return (
			this.repository
				.createQuery()
				.join('review.user', 'user', 'LEFT')
				.join('review.product', 'product', 'LEFT')
				// One translation, the request's own: the listing names the product in the
				// language the dashboard is read in, and falls back to the id when the product
				// carries none.
				.join(
					'product.contents',
					'product_content',
					'LEFT',
					'product_content.language = :language',
					{ language: language },
				)
				.join('review.variant', 'variant', 'LEFT')
				/*
				 * The product's default variant, for its code. A product carries no SKU of its
				 * own - only variants do - so a review naming no variant borrows the default
				 * one's, which is the code that stands for the product everywhere else.
				 */
				.join(
					'product.variants',
					'default_variant',
					'LEFT',
					'default_variant.is_default = true AND default_variant.deleted_at IS NULL',
				)
				.select([
					'review.id',
					'review.product_id',
					'review.variant_id',
					'review.order_id',
					'review.rating_avg',
					'review.content',
					'review.status',
					'review.is_pinned',
					'review.is_verified',
					'review.user_id',
					'review.created_at',
					'review.updated_at',
					'review.deleted_at',

					'user.id',
					'user.name',

					'product.id',
					'product_content.language',
					'product_content.label',
					'product_content.slug',

					'variant.id',
					'variant.sku',

					'default_variant.id',
					'default_variant.sku',
				])
				.filterBy('product_id', data.filter.product_id)
				.filterBy('variant_id', data.filter.variant_id)
				.filterBy('user_id', data.filter.user_id)
				.filterBy('status', data.filter.status)
				.filterBy('rating_avg', data.filter.rating_from, '>=')
				.filterByBoolean('is_pinned', data.filter.is_pinned)
				.filterByBoolean('is_verified', data.filter.is_verified)
				.filterByTerm(data.filter.term)
				// Both halves have to agree: the role decides whether deleted rows may be seen at
				// all, the filter whether this listing asked for them.
				.withDeleted(withDeleted && data.filter.is_deleted)
				.orderBy(data.order_by, data.direction)
				.pagination(data.page, data.limit)
				.all(true)
		);
	}

	/**
	 * @description Used in `find` method from the public controller
	 *
	 * Approved rows only, pinned ones first - a pin is the one ordering decision a moderator makes
	 * about a list, and it has to survive whatever the reader sorts by.
	 */
	public findByFilterPublic(
		data: ValidatorOutput<ReviewValidator, 'publicFind'>,
	) {
		return (
			this.repository
				.createQuery()
				.join('review.user', 'user', 'LEFT')
				.select([...PUBLIC_COLUMNS, 'user.id', 'user.name'])
				.filterBy('product_id', data.product_id)
				// Filtering to a variant leaves out the rows naming none: those are opinions about the
				// product, and a reader who picked a size asked for the ones speaking about it.
				.filterBy('variant_id', data.filter.variant_id)
				.filterBy('rating_avg', data.filter.rating_from, '>=')
				.filterByStatus(ReviewStatusEnum.APPROVED)
				.orderBy('is_pinned', 'DESC')
				.orderBy(data.order_by, data.direction)
				.pagination(data.page, data.limit)
				.all(true)
		);
	}

	/**
	 * @description Used in `find` method from the public controller
	 *
	 * The caller's own review, whatever its status: it is the one row they may see before a
	 * moderator has, and the storefront needs it to decide between offering the form and offering
	 * the edit.
	 */
	public getOwnReview(
		productId: number,
		userId: number,
	): Promise<ReviewEntity | null> {
		return this.repository
			.createQuery()
			.select([...PUBLIC_COLUMNS, 'review.status'])
			.filterBy('product_id', productId)
			.filterBy('user_id', userId)
			.first();
	}

	/**
	 * @description Used in `summary` method from the public controller
	 *
	 * What a product's star widget renders: how many reviews stand behind it, their average, the
	 * spread over whole stars and the average per dimension.
	 *
	 * Two queries rather than one - the totals are over every approved row, the distribution is
	 * grouped - and both are served by `IDX_review_product_rating`, which carries the same
	 * predicate. The dimension averages are read out of the jsonb with the column names taken from
	 * `REVIEW_RATING_DIMENSIONS`, so the SQL cannot name a key the entity does not allow; nothing
	 * from the request reaches it.
	 */
	public async getSummary(productId: number): Promise<ReviewSummary> {
		const totalsQuery = this.repository
			.createQuery()
			.filterBy('product_id', productId)
			.filterByStatus(ReviewStatusEnum.APPROVED)
			.getQuery()
			.select('COUNT(*)', 'total')
			.addSelect('AVG(review.rating_avg)', 'average');

		for (const dimension of REVIEW_RATING_DIMENSIONS) {
			totalsQuery.addSelect(
				`AVG((review.rating->>'${dimension}')::numeric)`,
				dimension,
			);
		}

		const totals =
			await totalsQuery.getRawOne<Record<string, string | null>>();

		const distributionRows = await this.repository
			.createQuery()
			.filterBy('product_id', productId)
			.filterByStatus(ReviewStatusEnum.APPROVED)
			.getQuery()
			.select('ROUND(review.rating_avg)', 'stars')
			.addSelect('COUNT(*)', 'count')
			.groupBy('ROUND(review.rating_avg)')
			.getRawMany<ReviewDistributionRow>();

		const distribution: Record<number, number> = {};

		for (const row of distributionRows) {
			distribution[Number(row.stars)] = Number(row.count);
		}

		const dimensions: Partial<Record<ReviewRatingDimension, number>> = {};

		for (const dimension of REVIEW_RATING_DIMENSIONS) {
			const value = totals?.[dimension];

			if (value !== null && value !== undefined) {
				dimensions[dimension] = Math.round(Number(value) * 100) / 100;
			}
		}

		return {
			// The driver returns an aggregate as a string - `COUNT(*)` is `bigint` and `AVG` is
			// `numeric` in Postgres, neither of which node-postgres narrows to a JS number.
			total: Number(totals?.total ?? 0),
			average: Math.round(Number(totals?.average ?? 0) * 100) / 100,
			distribution: distribution,
			dimensions: dimensions,
		};
	}

	/**
	 * Both keyspaces a review is read through: its own row, and the product summary it counts
	 * towards. The second is keyed by product rather than by review id - one approval changes an
	 * aggregate that no single id addresses - so it needs its own clean.
	 *
	 * Called after the write has committed, never inside the transaction: a concurrent reader
	 * could otherwise refill the cache from a snapshot the commit is about to supersede.
	 */
	private async cleanCaches(entry: ReviewEntity): Promise<void> {
		await cleanEntityCache(ReviewEntity, entry.id);
		await cleanEntityCacheBy(ReviewEntity, 'product', entry.product_id);
	}
}

export const reviewService = new ReviewService(
	getReviewRepository(),
	orderService,
);
