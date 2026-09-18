import { Configuration } from '@/config/settings.config';
import type { reviewController } from '@/features/review/review.controller';
import {
	REVIEW_RATING_DIMENSIONS,
	REVIEW_RATING_MAX,
	REVIEW_RATING_MIN,
	ReviewStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/review/review.entity';
import { getReviewEntityMock } from '@/features/review/review.mock';
import {
	MODERATION_REASON_MAX,
	OrderByEnum,
	paramsUpdateList,
	REVIEW_CONTENT_MAX,
	REVIEW_CONTENT_MIN,
} from '@/features/review/review.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getReviewEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Read from `STATUS_TRANSITIONS`, so the note cannot claim a move the entity refuses. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} → ${(to as string[]).join(' | ')}`)
	.join(', ');

/**
 * The dashboard half: moderate what buyers wrote. There is no create here - a review is written by
 * its author through `review-public.routes.ts`, and there is nobody else to attribute one to.
 */
export const docs: Record<
	keyof typeof reviewController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get review details',
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Review details, with its author and the variant bought',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Soft-deleted reviews are returned only to a caller whose role allows it. `order_id` is the order the purchase was made on: derived when the review is written, from the most recent completed order billed to one of the author's clients that carries a line for the product (and the variant, when named). Null when no such order exists",
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update review',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Review updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: `Only the presentation of a review is editable here - the scores are the author's. The moderation decision moves through the status endpoint instead. At least one of: ${paramsUpdateList.join(', ')}`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				content: {
					type: 'string',
					required: false,
					condition: `between ${REVIEW_CONTENT_MIN} and ${REVIEW_CONTENT_MAX} characters`,
				},
				is_pinned: {
					type: 'boolean',
					required: false,
				},
				is_verified: {
					type: 'boolean',
					required: false,
					condition: 'marks the author as a verified buyer',
				},
			},
			sample: {
				is_pinned: true,
				is_verified: true,
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete review',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Review removed successfully',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Soft - the row keeps its place and can be restored. It also frees the slot: one live review per buyer per product, so the author may write another one in the meantime',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore review',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Review restored successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: 'Answers 409 when the author has written a new review on that product since - the slot the deleted one held is taken',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get reviews',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Review list',
			dataSample: {
				entries: [entitySample],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						product_id: 17,
						status: ReviewStatusEnum.PENDING,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'The moderation queue is `status=pending` ordered by `created_at`. `term` searches the review text for a fragment; `rating_from` compares the stored average, not a single score',
			query: {
				page: {
					type: 'number',
					required: false,
					default: 1,
				},
				limit: {
					type: 'number',
					required: false,
					default: Configuration.get('filter.limit'),
				},
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
					default: OrderByEnum.ID,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					product_id: { type: 'number', required: false },
					variant_id: {
						type: 'number',
						required: false,
						condition:
							'reviews naming no variant are excluded when this is set',
					},
					user_id: { type: 'number', required: false },
					status: {
						type: 'enum',
						required: false,
						values: Object.values(ReviewStatusEnum),
					},
					rating_from: {
						type: 'number',
						required: false,
						condition: `between ${REVIEW_RATING_MIN} and ${REVIEW_RATING_MAX}`,
					},
					is_pinned: { type: 'boolean', required: false },
					is_verified: { type: 'boolean', required: false },
					term: { type: 'string', required: false },
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'withdrawn reviews join the listing; only for a role allowed to see deleted rows',
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: OrderByEnum.CREATED_AT,
				direction: OrderDirectionEnum.DESC,
				filter: {
					status: ReviewStatusEnum.PENDING,
				},
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Update review status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Review status updated successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote}. Nothing returns a review to ${ReviewStatusEnum.PENDING}. Only an approved review is public, and only an approved one accepts comments, ratings or complaints. The decision is stamped with the authenticated caller, never with an id from the request`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(ReviewStatusEnum),
				},
			},
			body: {
				moderation_reason: {
					type: 'string',
					required: false,
					condition: `at most ${MODERATION_REASON_MAX} characters; describes the state the review is in now and is overwritten on each decision`,
				},
			},
			sample: {
				moderation_reason: 'Off topic for this product',
			},
		},
	}),
};

/** Named here so the dimension list in the public docs and this file cannot drift. */
export const RATING_DIMENSIONS_NOTE = `one or more of: ${REVIEW_RATING_DIMENSIONS.join(', ')}, each a whole number between ${REVIEW_RATING_MIN} and ${REVIEW_RATING_MAX}`;
