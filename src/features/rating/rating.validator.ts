import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	RatingEmojiEnum,
	RatingEntityTypeEnum,
	RatingTypeEnum,
} from '@/features/rating/rating.entity';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	CREATED_AT: 'created_at',
} as const;

/** Mirrors `CHK_rating_like_range` and `CHK_rating_stars_range` on the entity. */
export const RATING_LIKE_VALUES: readonly number[] = [-1, 1];
export const RATING_STARS_MIN = 1;
export const RATING_STARS_MAX = 5;

/**
 * How many targets one summary request may ask about. A comment thread reads a page of comments
 * at a time, so the cap sits above a page and well below "every rating in the table" - the point
 * is that a caller cannot turn one request into a full scan.
 */
export const RATING_SUMMARY_MAX_TARGETS = 50;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_entity_type',
	'invalid_entity_id',
	'invalid_type',
	'invalid_value_like',
	'invalid_value_stars',
	'invalid_reaction',
	'invalid_entity_ids',
] as const;

export class RatingValidator extends BaseValidator<typeof validatorMessages> {
	/** The polymorphic target, shared by every schema that addresses one. */
	private targetSchema() {
		return {
			entity_type: this.validateEnum(
				RatingEntityTypeEnum,
				this.getMessage('invalid_entity_type'),
			),
			entity_id: this.validateId(this.getMessage('invalid_entity_id')),
		};
	}

	/**
	 * `-1` is a legitimate value here, so this cannot go through `validateNumber`, whose
	 * `onlyPositive` default rejects it and whose non-positive mode would also accept 0 and 7.
	 */
	private likeValueSchema() {
		return z.coerce
			.number({ message: this.getMessage('invalid_value_like') })
			.refine((value) => RATING_LIKE_VALUES.includes(value), {
				message: this.getMessage('invalid_value_like'),
			});
	}

	private starsValueSchema() {
		return this.validateNumber(
			this.getMessage('invalid_value_stars'),
		).refine(
			(value) => value >= RATING_STARS_MIN && value <= RATING_STARS_MAX,
			{ message: this.getMessage('invalid_value_stars') },
		);
	}

	/**
	 * One shape per rating type rather than one object carrying three optional columns.
	 * `CHK_rating_reaction` and `CHK_rating_value` hold the same rule in the database, so a
	 * looser schema here does not admit the row - it turns a 422 the caller can act on into a
	 * constraint violation, which reaches them as a masked 500.
	 */
	private ratingSchema() {
		return z.discriminatedUnion('type', [
			// Like - a direction, no reaction
			z.object({
				...this.targetSchema(),
				type: z.literal(RatingTypeEnum.LIKE),
				value: this.likeValueSchema(),
			}),

			// Stars - a score, no reaction
			z.object({
				...this.targetSchema(),
				type: z.literal(RatingTypeEnum.STARS),
				value: this.starsValueSchema(),
			}),

			// Emoji - a reaction, no value
			z.object({
				...this.targetSchema(),
				type: z.literal(RatingTypeEnum.EMOJI),
				reaction: this.validateEnum(
					RatingEmojiEnum,
					this.getMessage('invalid_reaction'),
				),
			}),
		]);
	}

	readonly create = this.ratingSchema();

	/**
	 * The same shape as `create`, and necessarily so: the target and `type` address the row and
	 * are not editable, while `value` / `reaction` are the payload - which is exactly what a
	 * cast carries. The controller merges the params holding the first three with the body
	 * holding the rest, so one schema validates the whole request.
	 */
	readonly update = this.ratingSchema();

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	/**
	 * The public counterpart of `delete`: a caller withdraws a rating by naming what they rated,
	 * never by id. An id would have to be checked against the caller afterwards; the target plus
	 * the identity resolved from the request addresses exactly one row to begin with.
	 */
	readonly publicDelete = z.object({
		...this.targetSchema(),
		type: this.validateEnum(
			RatingTypeEnum,
			this.getMessage('invalid_type'),
		),
	});

	/** The anonymous summary: the aggregate for one target, plus whatever the caller cast. */
	readonly publicRead = z.object({
		...this.targetSchema(),
	});

	/**
	 * The same summary for a set of targets at once - what a list of rated things needs, and the
	 * only shape that keeps a comment thread from issuing one request per comment.
	 *
	 * The ids arrive as a comma-separated query value, which is what a URL can carry; anything
	 * already shaped as an array (a repeated parameter) is taken as it is.
	 */
	readonly publicSummaryList = z.object({
		entity_type: this.validateEnum(
			RatingEntityTypeEnum,
			this.getMessage('invalid_entity_type'),
		),
		entity_ids: z.preprocess(
			(value) => (typeof value === 'string' ? value.split(',') : value),
			z
				.array(this.validateId(this.getMessage('invalid_entity_ids')), {
					message: this.getMessage('invalid_entity_ids'),
				})
				.min(1, { message: this.getMessage('invalid_entity_ids') })
				.max(RATING_SUMMARY_MAX_TARGETS, {
					message: this.getMessage('invalid_entity_ids'),
				}),
		),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			entity_type: this.validateEnum(
				RatingEntityTypeEnum,
				this.getMessage('invalid_entity_type'),
				{ required: false },
			),
			entity_id: this.validateId(this.getMessage('invalid_entity_id'), {
				required: false,
			}),
			type: this.validateEnum(
				RatingTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			reaction: this.validateEnum(
				RatingEmojiEnum,
				this.getMessage('invalid_reaction'),
				{ required: false },
			),
			user_id: this.validateId(
				this.getMessage('invalid_id', { name: 'user_id' }),
				{
					required: false,
				},
			),
		},
	});
}
