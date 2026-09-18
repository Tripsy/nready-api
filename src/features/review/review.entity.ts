import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type OrderEntity from '@/features/order/order.entity';
import type ProductEntity from '@/features/product/product.entity';
import type ProductVariantEntity from '@/features/product/product-variant.entity';
import type UserEntity from '@/features/user/user.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { StatusTransitions } from '@/shared/types/common.type';

export const ReviewStatusEnum = {
	PENDING: 'pending', // Awaiting moderation
	REJECTED: 'rejected', // Rejected by moderator
	SPAM: 'spam', // Marked as spam
	APPROVED: 'approved', // Visible to public
} as const;

export type ReviewStatus =
	(typeof ReviewStatusEnum)[keyof typeof ReviewStatusEnum];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<ReviewStatus> = {
	[ReviewStatusEnum.PENDING]: [
		ReviewStatusEnum.REJECTED,
		ReviewStatusEnum.SPAM,
		ReviewStatusEnum.APPROVED,
	],
	[ReviewStatusEnum.REJECTED]: [ReviewStatusEnum.APPROVED],
	[ReviewStatusEnum.SPAM]: [
		ReviewStatusEnum.REJECTED,
		ReviewStatusEnum.APPROVED,
	],
	[ReviewStatusEnum.APPROVED]: [
		ReviewStatusEnum.REJECTED,
		ReviewStatusEnum.SPAM,
	],
};

/**
 * The dimensions a reviewer may score, each out of 5. A review carries at least one of them and
 * nothing else - `CHK_review_rating_keys` holds both halves of that rule.
 *
 * The list is repeated as SQL literals in the checks below, since a decorator takes a fixed string.
 * Adding a dimension means a migration; dropping one leaves the older rows carrying it, so read
 * every dimension as optional no matter what the current list says.
 */
export const REVIEW_RATING_DIMENSIONS = [
	'quality',
	'price',
	'service',
	'delivery',
] as const;

export type ReviewRatingDimension = (typeof REVIEW_RATING_DIMENSIONS)[number];

export type ReviewRating = Partial<Record<ReviewRatingDimension, number>>;

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

const ENTITY_TABLE_NAME = 'review';

/**
 * A product review: the score and the text a buyer leaves, moderated the same way a comment is.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores product reviews',
})
@Index('IDX_review_product', ['product_id', 'status', 'created_at'])
// Product average and the "4 stars and up" filter, both of which read only public rows.
@Index('IDX_review_product_rating', ['product_id', 'rating_avg'], {
	where: `status = 'approved' AND deleted_at IS NULL`,
})
// Moderation queue. Partial: only `pending` rows are ever listed this way, and the table is
// dominated by rows that have already left that state.
@Index('IDX_review_moderation', ['created_at'], {
	where: `status = 'pending' AND deleted_at IS NULL`,
})
@Index('IDX_review_user_status', ['user_id', 'status'])
// The referencing side of `order_id`, which Postgres does not index on its own - without it every
// hard delete of an order scans this table. Partial because the column is null on every review
// with no purchase behind it, and a lookup by order implies the predicate anyway.
@Index('IDX_review_order', ['order_id'], {
	where: 'order_id IS NOT NULL',
})
// Listing filtered to one variant - "reviews for the 32 cm", the size the storefront is showing.
// Partial: rows with no variant named cannot answer that question, and only public rows are listed.
@Index('IDX_review_variant', ['variant_id', 'created_at'], {
	where: `variant_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL`,
})
// One review per user per *product*, not per variant: a shirt bought in two sizes is still one
// opinion, and a per-variant slot would let the same person score the same product four times.
// A withdrawn review leaves the slot free for a new one.
@Index('UQ_review_user', ['product_id', 'user_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
@Check(
	'CHK_review_rating_avg_range',
	`rating_avg BETWEEN ${REVIEW_RATING_MIN} AND ${REVIEW_RATING_MAX}`,
)
/**
 * Shape of `rating`: an object holding at least one known dimension, no unknown key, and a number
 * within range under each key present.
 *
 * Subtracting the known keys leaves `{}` only when no unknown key is there, and `?|` then demands
 * at least one. Values are compared as jsonb rather than cast to numeric: a cast over a string
 * value raises `22P02` instead of failing the constraint, which reaches the client as a masked 500
 * rather than a validation error. jsonb ordering sorts strings above every number, so a
 * non-numeric value falls outside the range on its own - the `jsonb_typeof` guard states the rule
 * regardless. It reads worse than a `jsonb_each` subquery would, which Postgres forbids here.
 */
@Check(
	'CHK_review_rating',
	`jsonb_typeof(rating) = 'object'
	 AND rating - 'quality' - 'price' - 'service' - 'delivery' = '{}'::jsonb
	 AND rating ?| array['quality', 'price', 'service', 'delivery']
	 AND (NOT rating ? 'quality' OR (jsonb_typeof(rating->'quality') = 'number' AND rating->'quality' BETWEEN '${REVIEW_RATING_MIN}'::jsonb AND '${REVIEW_RATING_MAX}'::jsonb))
	 AND (NOT rating ? 'price' OR (jsonb_typeof(rating->'price') = 'number' AND rating->'price' BETWEEN '${REVIEW_RATING_MIN}'::jsonb AND '${REVIEW_RATING_MAX}'::jsonb))
	 AND (NOT rating ? 'service' OR (jsonb_typeof(rating->'service') = 'number' AND rating->'service' BETWEEN '${REVIEW_RATING_MIN}'::jsonb AND '${REVIEW_RATING_MAX}'::jsonb))
	 AND (NOT rating ? 'delivery' OR (jsonb_typeof(rating->'delivery') = 'number' AND rating->'delivery' BETWEEN '${REVIEW_RATING_MIN}'::jsonb AND '${REVIEW_RATING_MAX}'::jsonb))`,
)
export default class ReviewEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({
		type: 'int',
		nullable: false,
	})
	product_id!: number;

	/**
	 * The variant the review is *about* - the 32 cm Margherita, the black M shirt - kept because
	 * that is what the reviewer actually received: a complaint about the fit belongs to a size, and
	 * a storefront showing one variant can narrow the list to it.
	 *
	 * The review itself stays product-level - `UQ_review_user` and the product average both count
	 * per product - so this only records which sibling was bought, it does not divide the reviews
	 * into separate conversations.
	 *
	 * Nullable, and expected to be null often: a review written from a product page, an import, or
	 * a purchase whose variant has since been replaced names none. Read it as "which one, if the
	 * answer is known".
	 */
	@Column({
		type: 'int',
		nullable: true,
	})
	variant_id?: number | null;

	/**
	 * The order the reviewed purchase was made on, when it is known.
	 *
	 * Written once, by `ReviewService.create`, through `OrderService.findLatestPurchase`: the most
	 * recent `completed` order billed to one of the author's clients (`client.user_id`) carrying a
	 * line for this product - and this variant, when one is named. Never taken from the request,
	 * and absent from the public read - the provenance is for the dashboard.
	 *
	 * Nullable permanently: a review written with no purchase on record, an import, or a purchase
	 * made off-platform has no order to name. `cli/review-verify-backfill.ts` fills it in for rows
	 * written before the lookup existed.
	 */
	@Column({
		type: 'int',
		nullable: true,
	})
	order_id?: number | null;

	@Column({
		type: 'jsonb',
		nullable: false,
		comment: 'Scores out of 5, keyed by dimension',
	})
	rating!: ReviewRating;

	/**
	 * The review's star score: the dimensions set in `rating` summed and divided by how many were
	 * set - `(quality + price + service + delivery) / 4` when all four are given, `(quality +
	 * service) / 2` when only those two are. Never divided by the number of dimensions that exist,
	 * which would score a partly-filled review as though the blanks were zeros. `CHK_review_rating`
	 * guarantees at least one is present, so the divisor is never zero, and each is at least 1, so
	 * the result stays inside the 1-5 that `CHK_review_rating_avg_range` holds.
	 *
	 * Written by `ReviewService` on every write, rounded to the column's 2 decimals there rather
	 * than left to Postgres - (5 + 4 + 4) / 3 stores as 4.33.
	 *
	 * This is what a product average aggregates and what a star filter compares against:
	 * `AVG(rating_avg)` over a plain column, instead of unpacking jsonb per row and deciding there
	 * how a review scored on three dimensions compares to one scored on four. Denormalized, so it
	 * holds only as well as the service maintains it.
	 */
	@Column('decimal', {
		precision: 3,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	rating_avg!: number;

	@Column({
		type: 'text',
		nullable: false,
	})
	content!: string;

	@Column({
		type: 'enum',
		enum: ReviewStatusEnum,
		default: ReviewStatusEnum.PENDING,
		nullable: false,
	})
	status!: ReviewStatus;

	// Author - always a registered user, which is what `UQ_review_user` counts on to hold one
	// review per product.
	@Column({
		type: 'int',
		nullable: false,
	})
	user_id!: number;

	// Flags
	@Column({
		type: 'boolean',
		default: false,
	})
	is_pinned!: boolean;

	/**
	 * Set true on write when `order_id` is found; otherwise false until a moderator ticks it - the
	 * override for a purchase the lookup cannot see (a phone order, a marketplace, a receipt).
	 * Nothing derives it back to false, so a moderator's decision is never overwritten.
	 */
	@Column({
		type: 'boolean',
		default: false,
		comment: 'Verified buyer',
	})
	is_verified!: boolean;

	// Moderation
	@Column({
		type: 'timestamp',
		nullable: true,
	})
	moderated_at?: Date | null;

	@Column({
		type: 'int',
		nullable: true,
		comment: 'Moderator user ID',
	})
	moderated_by?: number | null;

	@Column({
		type: 'varchar',
		nullable: true,
		comment: 'Reason for moderation action',
	})
	moderation_reason?: string | null;

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product?: ProductEntity;

	/**
	 * Composite over both columns at once, pointing at `product_variant (id, product_id)` - the
	 * pair has to exist together on one variant row, so a review cannot name a variant belonging to
	 * a different product. Postgres skips a MATCH SIMPLE composite key when any of its columns is
	 * null, which is what leaves `variant_id` free to stay unset.
	 *
	 * CASCADE rather than the RESTRICT `order_line` carries: an order line is a financial record
	 * that has to outlive the catalog, a review is not, and `product_id` above already cascades -
	 * so a deleted product takes its reviews with it either way. RESTRICT here would additionally
	 * deadlock that delete, since dropping a product cascades into its variants while the reviews
	 * still cite them. Variants are soft-deleted in normal use, so this fires only on a real purge.
	 */
	@ManyToOne('ProductVariantEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn([
		{ name: 'variant_id', referencedColumnName: 'id' },
		{ name: 'product_id', referencedColumnName: 'product_id' },
	])
	variant?: ProductVariantEntity;

	/**
	 * SET NULL rather than the CASCADE the catalog keys carry: the review is the reader's, not the
	 * order's, and a purged order should cost it its provenance rather than its existence. Orders
	 * are soft-deleted in normal use, so this fires only on a real purge.
	 */
	@ManyToOne('OrderEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'order_id' })
	order?: OrderEntity | null;

	/**
	 * Who took the last moderation decision, joined so a dashboard read can name them instead of
	 * printing an id.
	 *
	 * **Declared without a foreign key** (`createForeignKeyConstraints: false`), unlike
	 * `article.author_id` which carries one with `SET NULL`. This is an audit column: a null here
	 * already means "nobody decided, a background sweep did", so letting a deleted account null it
	 * would make a decision somebody took indistinguishable from one nobody did. The id therefore
	 * outlives the account, and a moderator whose user row is gone renders as the bare id - which
	 * is what the trail is for.
	 */
	@ManyToOne('UserEntity', {
		createForeignKeyConstraints: false,
	})
	@JoinColumn({ name: 'moderated_by' })
	moderator?: UserEntity | null;

	// Cascade is forced by `user_id` being NOT NULL - there is no anonymous state to fall back to,
	// so a closed account takes its reviews with it and every product average it fed has to be
	// recomputed.
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity;
}
