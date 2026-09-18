import type ReviewEntity from '@/features/review/review.entity';
import { ReviewStatusEnum } from '@/features/review/review.entity';
import { OrderByEnum } from '@/features/review/review.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * One review as a read returns it: the row's own columns plus the slices of its author and its
 * variant that a listing shows.
 *
 * `user` and `variant` are joined only when a read asks for them, so the shape is cast rather than
 * assembled from full entities - a fabricated user row here would be a shape no response carries.
 */
export function getReviewEntityMock(): ReviewEntity {
	return {
		id: 12,
		product_id: 17,
		variant_id: 41,
		// The completed order the purchase was found on, which is also what set `is_verified`
		order_id: 104,
		rating: {
			quality: 5,
			price: 4,
			delivery: 4,
		},
		rating_avg: 4.33,
		content: 'Arrived warm and the dough was exactly as ordered.',
		status: ReviewStatusEnum.APPROVED,
		is_pinned: false,
		is_verified: true,
		user_id: 7,
		moderated_at: createPastDate(3600),
		moderated_by: 1,
		moderation_reason: null,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		user: {
			id: 7,
			name: 'Ada Lovelace',
		},
		variant: {
			id: 41,
			sku: 'PIZZA-MARG-30',
		},
		// Joined by the listing so the target reads as a name and a code rather than two ids.
		// One translation, the requested language's.
		product: {
			id: 17,
			contents: [
				{
					language: 'en',
					label: 'Pizza Margherita',
					slug: 'pizza-margherita',
				},
			],
		},
		// Whoever took the last decision. Absent on a review nobody has looked at, and on one
		// whose moderator account has since been deleted - the id outlives the account.
		moderator: {
			id: 1,
			name: 'Grace Hopper',
		},
	} as unknown as ReviewEntity;
}

export const reviewInputPayloads = {
	find: {
		page: 1,
		limit: 20,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			product_id: 17,
			status: ReviewStatusEnum.PENDING,
		},
	},
};
