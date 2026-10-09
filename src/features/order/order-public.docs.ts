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
			description:
				'Orders billed to any client linked to the account - without a status filter, every one but the canceled',
			dataSample: {
				entries: [
					{
						...withoutDeletedAt(orderSample),
						totals: orderWithLinesSample.totals,
						awaiting_payment: false,
					},
				],
				pagination: {
					page: 1,
					limit: Configuration.get('filter.limit'),
					total: 1,
				},
				query: {
					order_by: PublicOrderByEnum.CREATED_AT,
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
					default: PublicOrderByEnum.CREATED_AT,
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
			dataSample: {
				...withoutDeletedAt(orderWithLinesSample),
				awaiting_payment: false,
			},
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `Requires an account. An order billed to somebody else's client answers 404, the same as a missing one. The client carries its \`company_cui\`, \`company_reg_com\` and \`contact_phone\` here, beyond what the listing shows. \`awaiting_payment\` is true on a pending order not paid cash on delivery whose payment is still open - requested, authorized or waiting on the buyer - and false otherwise; it is not a status. ${totalsNote}`,
			params: {
				id: { type: 'number', required: true },
			},
		},
	}),
	cancel: helperApiInputDocumentation({
		description: "Cancel one of the caller's own pending orders",
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Order canceled',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: "Requires an account. An order billed to somebody else's client answers 404. Answers 409 when the order is no longer pending, has been invoiced, or has a payment past a request (authorized, awaiting action or captured) - those are the business's to undo. The order's pending payment requests are canceled with it, and its deliveries that have not shipped move to `canceled`",
			params: {
				id: { type: 'number', required: true },
			},
		},
	}),
};
