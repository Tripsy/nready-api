import {
	RatingEmojiEnum,
	RatingEntityTypeEnum,
	RatingTypeEnum,
} from '@/features/rating/rating.entity';
import { RATING_SUMMARY_MAX_TARGETS } from '@/features/rating/rating.validator';
import type { ratingPublicController } from '@/features/rating/rating-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/**
 * The reader-facing half of the rating feature, mounted under `/public/ratings` by
 * `rating-public.routes.ts`. Documented separately from `rating.docs.ts` because it is a route
 * module of its own - a different base path, a different controller, and no bearer token - even
 * though both describe the same entity.
 *
 * Every action is open to guests, so authorization here is an identity rather than a permission:
 * the caller's account when signed in, and always a hash of the origin address. A request whose
 * address cannot be resolved is refused with 400 rather than stored under a shared fallback,
 * which would collapse every such visitor into one vote per target.
 */
const targetParams = {
	entity_type: {
		type: 'enum' as const,
		required: true,
		values: Object.values(RatingEntityTypeEnum),
	},
	entity_id: {
		type: 'string' as const,
		required: true,
	},
};

const typeParam = {
	type: 'enum' as const,
	required: true,
	values: Object.values(RatingTypeEnum),
	condition: 'decides which of value / reaction the rating carries',
};

const valueNote =
	'a like takes value 1 or -1, stars a whole number from 1 to 5, and an emoji a reaction instead of a value';

const entitySample: Record<string, unknown> = {
	id: 31,
	entity_type: RatingEntityTypeEnum.ARTICLE,
	entity_id: 4,
	type: RatingTypeEnum.STARS,
	value: 5,
	reaction: null,
	user_id: 7,
	created_at: '2026-08-20T09:14:00.000Z',
	updated_at: null,
};

/** The shape both reads fold their groups into. */
const summarySample: Record<string, unknown> = {
	total: 12,
	like: { up: 7, down: 1, score: 6 },
	stars: { count: 4, average: 4.5, distribution: { 4: 2, 5: 2 } },
	emoji: { love: 3 },
};

const ownSample: Record<string, unknown>[] = [
	{
		id: 31,
		type: RatingTypeEnum.STARS,
		value: 5,
		reaction: null,
		created_at: '2026-08-20T09:14:00.000Z',
		updated_at: null,
	},
];

export const docs: Record<
	keyof typeof ratingPublicController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Cast a rating',
		success: {
			status: 201,
			description: 'Rating recorded successfully',
			dataSample: entitySample,
		},
		withErrors: [400, 403, 409, 422],
		request: {
			notes: `Strictly an insert - a caller who already rated this target with this type changes it through the update route instead. 409 says which rule was hit: the caller's own earlier rating, or a rating already cast from the same address by somebody else. 403 means the target has ratings turned off or is gone, and 400 that the origin address could not be resolved. ${valueNote}`,
			body: {
				...targetParams,
				type: typeParam,
				value: {
					type: 'number',
					required: false,
					condition:
						'required for a like or stars, absent for an emoji',
				},
				reaction: {
					type: 'enum',
					required: false,
					values: Object.values(RatingEmojiEnum),
					condition: 'required for an emoji, absent otherwise',
				},
			},
			sample: {
				entity_type: RatingEntityTypeEnum.ARTICLE,
				entity_id: 4,
				type: RatingTypeEnum.STARS,
				value: 5,
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Change a rating already cast',
		success: {
			status: 200,
			description: 'Rating updated successfully',
			dataSample: entitySample,
		},
		withErrors: [400, 404, 422],
		request: {
			notes: `The row is addressed by what was rated, never by id: an id would have to be checked against the caller afterwards, while the target plus the identity resolved from the request names exactly one row to begin with. A target in the body cannot redirect the write - the path wins. 404 means this caller holds no rating of that type on that target. ${valueNote}`,
			params: {
				...targetParams,
				type: typeParam,
			},
			body: {
				value: {
					type: 'number',
					required: false,
					condition:
						'required for a like or stars, absent for an emoji',
				},
				reaction: {
					type: 'enum',
					required: false,
					values: Object.values(RatingEmojiEnum),
					condition: 'required for an emoji, absent otherwise',
				},
			},
			sample: {
				value: 4,
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Withdraw a rating',
		success: {
			status: 200,
			description: 'Rating removed successfully',
		},
		withErrors: [400, 404, 422],
		request: {
			notes: "Addressed by target for the same reason as the update. This takes the rating back entirely - changing one's mind about the score goes through the update route and keeps the row. The removal is permanent: the table has no deleted state",
			params: {
				...targetParams,
				type: typeParam,
			},
		},
	}),
	summaries: helperApiInputDocumentation({
		description: 'Get the rating summaries of several targets at once',
		success: {
			status: 200,
			description:
				'One summary per target that has ratings, plus whatever the caller cast on any of them',
			dataSample: {
				summaries: { 4: summarySample },
				own: { 4: ownSample },
			},
		},
		withErrors: [400, 422],
		request: {
			notes: `What a list of rated things reads: a page of comments would otherwise call the single-target route once per comment. Two queries answer the whole set, and at most ${RATING_SUMMARY_MAX_TARGETS} targets may be asked about at a time, so one request cannot turn into a full scan. A target with no ratings is simply absent from the response`,
			params: {
				entity_type: targetParams.entity_type,
			},
			query: {
				entity_ids: {
					type: 'string',
					required: true,
					condition: `a comma-separated list of ids, 1 to ${RATING_SUMMARY_MAX_TARGETS} of them; a repeated parameter is accepted as an array`,
				},
			},
			sample: {
				entity_ids: '4,5,6',
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get the rating summary of one target',
		success: {
			status: 200,
			description:
				'The aggregate for the target, plus whatever the caller cast on it',
			dataSample: {
				summary: summarySample,
				own: ownSample,
			},
		},
		withErrors: [400, 422],
		request: {
			notes: 'The two halves a rating widget renders at once, resolved together rather than over two round trips. Never cached - a stale count is the one thing a reader notices immediately after voting. `own` is empty for a visitor who has not rated this target',
			params: targetParams,
		},
	}),
};
