import { Configuration } from '@/config/settings.config';
import type { ratingController } from '@/features/rating/rating.controller';
import {
	RatingEmojiEnum,
	RatingEntityTypeEnum,
	RatingTypeEnum,
} from '@/features/rating/rating.entity';
import { OrderByEnum } from '@/features/rating/rating.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Written out rather than taken from a `rating.mock.ts`, which this feature does not have. It is
 * the dashboard view, so it carries the rater's account when there is one; `user_ip_hash` is not
 * in it - that column identifies a visitor across every rating they ever cast, no decision is
 * made from it, and it is returned by no route.
 */
const entitySample: Record<string, unknown> = {
	id: 31,
	entity_type: RatingEntityTypeEnum.ARTICLE,
	entity_id: 4,
	type: RatingTypeEnum.STARS,
	value: 5,
	reaction: null,
	user_id: 7,
	user: {
		id: 7,
		name: 'Ada Lovelace',
		email: 'ada@sample.com',
	},
	created_at: '2026-08-20T09:14:00.000Z',
	updated_at: null,
};

/**
 * The dashboard half: read one rating, remove one, list them. There is no create and no update
 * here - a rating is cast by a reader through `rating-public.routes.ts`, and this side only ever
 * looks at the result or takes it away.
 */
export const docs: Record<
	keyof typeof ratingController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get rating details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Rating details, with the rater when it has one',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'A rating cast without an account is anchored to a hashed origin address, which is not returned - a guest rating carries nothing beyond what it says about the target',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete rating',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Rating removed successfully',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Permanent - this table has no `deleted_at`, so there is no restore. A soft-deleted row would go on holding its slot under both uniques, barring that address from ever rating the target again, and would keep counting in the aggregates',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get ratings',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Rating list',
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
						entity_type: RatingEntityTypeEnum.ARTICLE,
						entity_id: 4,
						type: RatingTypeEnum.STARS,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'There is no free-text term on this listing - a rating carries no text to search. Narrow it by target, by rating type or by rater instead',
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
					entity_type: {
						type: 'enum',
						required: false,
						values: Object.values(RatingEntityTypeEnum),
					},
					entity_id: { type: 'string', required: false },
					type: {
						type: 'enum',
						required: false,
						values: Object.values(RatingTypeEnum),
					},
					reaction: {
						type: 'enum',
						required: false,
						values: Object.values(RatingEmojiEnum),
						condition: 'only emoji ratings carry one',
					},
					user_id: {
						type: 'string',
						required: false,
						condition:
							'guest ratings have none and are never matched',
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: OrderByEnum.ID,
				direction: OrderDirectionEnum.DESC,
				filter: {
					entity_type: RatingEntityTypeEnum.ARTICLE,
					entity_id: 4,
					type: RatingTypeEnum.STARS,
				},
			},
		},
	}),
};
