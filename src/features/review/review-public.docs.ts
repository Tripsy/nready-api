import { Configuration } from '@/config/settings.config';
import { RATING_DIMENSIONS_NOTE } from '@/features/review/review.docs';
import {
	REVIEW_RATING_MAX,
	REVIEW_RATING_MIN,
} from '@/features/review/review.entity';
import { getReviewEntityMock } from '@/features/review/review.mock';
import {
	PublicOrderByEnum,
	publicParamsUpdateList,
	REVIEW_CONTENT_MAX,
	REVIEW_CONTENT_MIN,
} from '@/features/review/review.validator';
import type { reviewPublicController } from '@/features/review/review-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * What a visitor is shown, which is narrower than the dashboard read the mock describes. Stripped:
 * the moderation trail (a decision taken about the review), `order_id` (provenance the storefront
 * has no business with), and the joined `product` / `variant` rows, which only the dashboard
 * listing asks for.
 */
const publicSample = (() => {
	const {
		status,
		moderated_at,
		moderated_by,
		moderation_reason,
		moderator,
		deleted_at,
		order_id,
		product,
		variant,
		...rest
	} = getReviewEntityMock() as unknown as Record<string, unknown>;

	return rest;
})();

const summarySample: Record<string, unknown> = {
	total: 24,
	average: 4.42,
	distribution: { 3: 2, 4: 9, 5: 13 },
	dimensions: { quality: 4.6, price: 4.1, delivery: 4.5 },
};

/**
 * The storefront half. The writes need an account - `user_id` is `NOT NULL`, so a review has an
 * author by construction - while both reads are open to anyone.
 *
 * Documented as its own module because it is one: docs are registered under the route file's own
 * name, so these actions could not be folded into `review.docs.ts`.
 */
export const docs: Record<
	keyof typeof reviewPublicController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Write a review',
		success: {
			status: 201,
			description: 'Review submitted and awaiting moderation',
			dataSample: publicSample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: 'Requires an account. Every review lands awaiting moderation - it is a lasting claim about something being sold, so it is not published unread. A second review of the same product answers 409; revise the first one instead. is_verified is set when the caller holds a completed order for the product (and the variant, when named) billed to one of their own clients; it is never taken from the body',
			body: {
				product_id: {
					type: 'number',
					required: true,
				},
				variant_id: {
					type: 'number',
					required: false,
					condition:
						'must belong to that product; omitted when the review is about the product itself',
				},
				rating: {
					type: 'object',
					required: true,
					condition: RATING_DIMENSIONS_NOTE,
				},
				content: {
					type: 'string',
					required: true,
					condition: `between ${REVIEW_CONTENT_MIN} and ${REVIEW_CONTENT_MAX} characters`,
				},
			},
			sample: {
				product_id: 17,
				variant_id: 41,
				rating: { quality: 5, price: 4, delivery: 4 },
				content: 'Arrived warm and the dough was exactly as ordered.',
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Revise your own review',
		success: {
			status: 200,
			description: 'Review updated successfully',
			dataSample: publicSample,
		},
		withAuthErrors: true,
		withErrors: [403, 404, 422],
		request: {
			notes: `Addressed by product, never by review id: one live review per buyer per product, so the path plus the account names exactly one row. Only a pending review may be revised - once a moderator has approved, rejected or marked it as spam the write is refused with 403. At least one of: ${publicParamsUpdateList.join(', ')}`,
			params: {
				product_id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				rating: {
					type: 'object',
					required: false,
					condition: RATING_DIMENSIONS_NOTE,
				},
				content: {
					type: 'string',
					required: false,
					condition: `between ${REVIEW_CONTENT_MIN} and ${REVIEW_CONTENT_MAX} characters`,
				},
			},
			sample: {
				rating: { quality: 4, price: 4 },
				content:
					'Still good on the second order, though the box was dented.',
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Withdraw your own review',
		success: {
			status: 200,
			description: 'Review removed successfully',
		},
		withAuthErrors: true,
		withErrors: [403, 404],
		request: {
			notes: 'Only while the review is still pending - a review a moderator has approved, rejected or marked as spam is refused with 403. Soft, and withdrawing a pending review frees the slot, so the buyer may write a new one afterwards',
			params: {
				product_id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get the reviews of a product',
		success: {
			status: 200,
			description:
				"Approved reviews, plus the caller's own when they hold one",
			dataSample: {
				entries: [publicSample],
				own: null,
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
			},
		},
		withErrors: [422],
		request: {
			notes: "Approved reviews only. `own` is the caller's own review whatever its status - the one row they may see before a moderator has - and is null for a visitor with no account or no review. Pinned reviews come first, whatever the sort",
			params: {
				product_id: {
					type: 'number',
					required: true,
				},
			},
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
					values: Object.values(PublicOrderByEnum),
					default: PublicOrderByEnum.CREATED_AT,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					variant_id: {
						type: 'number',
						required: false,
						condition:
							'narrows to the reviews naming that variant; the ones naming none drop out',
					},
					rating_from: {
						type: 'number',
						required: false,
						condition: `between ${REVIEW_RATING_MIN} and ${REVIEW_RATING_MAX}, compared against the review average`,
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: PublicOrderByEnum.RATING_AVG,
				direction: OrderDirectionEnum.DESC,
				filter: {
					rating_from: 4,
				},
			},
		},
	}),
	summary: helperApiInputDocumentation({
		description: 'Get the review summary of a product',
		success: {
			status: 200,
			description:
				'Totals, average, star distribution and per-dimension averages',
			dataSample: summarySample,
		},
		withErrors: [422],
		request: {
			notes: 'Over approved reviews only. `distribution` is keyed by whole stars, the review average rounded; `dimensions` averages each score over the reviews that gave it, so a dimension nobody scored is absent. Cached per product and dropped by any write that changes it',
			params: {
				product_id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
};
