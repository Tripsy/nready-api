import { Configuration } from '@/config/settings.config';
import {
	orderSample,
	orderWithLinesSample,
	totalsNote,
} from '@/features/order/order.docs';
import { OrderStatusEnum } from '@/features/order/order.entity';
import { PublicOrderByEnum } from '@/features/order/order.validator';
import type { orderPublicController } from '@/features/order/order-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/** The dashboard samples minus `deleted_at`, which no buyer read selects. */
const withoutDeletedAt = (sample: Record<string, unknown>) => {
	const { deleted_at, ...rest } = sample;

	return rest;
};

/**
 * The storefront half: the account's own order history. Every row is the caller's own - an order
 * belongs to the account through the client it is billed to - and there is no permission to hold.
 *
 * Documented as its own module because docs are registered under the route file's own name.
 */
export const docs: Record<
	keyof typeof orderPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: "The caller's own orders",
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Orders billed to any client linked to the account',
			dataSample: {
				entries: [
					{
						...withoutDeletedAt(orderSample),
						totals: orderWithLinesSample.totals,
					},
				],
				pagination: {
					page: 1,
					limit: Configuration.get('filter.limit'),
					total: 1,
				},
				query: {
					order_by: PublicOrderByEnum.ISSUED_AT,
					direction: OrderDirectionEnum.DESC,
					limit: Configuration.get('filter.limit'),
					page: 1,
					filter: {},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `Requires an account. Each entry carries its \`totals\` but not its lines - read one order to get those. Deleted orders are never listed. ${totalsNote}`,
			query: {
				page: { type: 'number', required: false, default: 1 },
				limit: {
					type: 'number',
					required: false,
					default: Configuration.get('filter.limit'),
				},
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(PublicOrderByEnum),
					default: PublicOrderByEnum.ISSUED_AT,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					status: {
						type: 'enum',
						required: false,
						values: Object.values(OrderStatusEnum),
					},
				},
			},
		},
	}),

	read: helperApiInputDocumentation({
		description: "One of the caller's own orders",
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'The order, with its client, lines and totals',
			dataSample: withoutDeletedAt(orderWithLinesSample),
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `Requires an account. An order billed to somebody else's client answers 404, the same as a missing one. ${totalsNote}`,
			params: {
				id: { type: 'number', required: true },
			},
		},
	}),
};
