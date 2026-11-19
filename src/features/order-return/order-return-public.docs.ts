import { Configuration } from '@/config/settings.config';
import {
	OrderReturnReasonEnum,
	OrderReturnStatusEnum,
} from '@/features/order-return/order-return.entity';
import { ORDER_RETURN_NOTES_MAX } from '@/features/order-return/order-return.validator';
import type { orderReturnPublicController } from '@/features/order-return/order-return-public.controller';
import { ShippingStatusEnum } from '@/features/shipping/shipping.entity';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/** One return as the buyer is shown it - no internal notes, no account or reversal ids. */
const publicSample: Record<string, unknown> = {
	id: 7,
	ref_code: 'RMA',
	ref_number: 7,
	status: OrderReturnStatusEnum.APPROVED,
	reason: OrderReturnReasonEnum.WRONG_ITEM,
	customer_notes: 'Ordered M, received L',
	response: 'Approved - the courier will collect it',
	decided_at: '2026-11-12T14:02:00.000Z',
	received_at: null,
	closed_at: null,
	order_id: 118,
	shipping: {
		id: 64,
		status: ShippingStatusEnum.PENDING,
		tracking_number: null,
		tracking_url: null,
	},
	lines: [
		{
			id: 31,
			order_return_id: 7,
			variant_id: 27,
			product_id: 12,
			quantity: 1,
			sku: 'OXF-M-BLUE',
			label: 'Oxford shirt',
		},
	],
	created_at: '2026-11-12T10:15:00.000Z',
	updated_at: '2026-11-12T14:02:00.000Z',
};

const orderParams = {
	order_id: { type: 'number' as const, required: true },
};

/**
 * The storefront half: returns against the caller's own orders. Documented as its own module
 * because docs are registered under the route file's own name.
 */
export const docs: Record<
	keyof typeof orderReturnPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: "The returns of one of the caller's own orders",
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Returns against the order, oldest first',
			dataSample: { entries: [publicSample] },
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'An order that is not billed to one of the clients of the account answers 404, like one that does not exist',
			params: orderParams,
		},
	}),
	returnable: helperApiInputDocumentation({
		description: 'What of an own order can still be returned',
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Per item, what is delivered and not yet being returned',
			dataSample: {
				deadline: '2026-11-26T09:40:00.000Z',
				lines: [
					{
						variant_id: 27,
						product_id: 12,
						sku: 'OXF-M-BLUE',
						label: 'Oxford shirt',
						returnable: 2,
					},
				],
			},
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `deadline is the last delivery plus ${Configuration.get('orderReturn.windowDays')} days - null while nothing has arrived. An empty list means nothing is left to return`,
			params: orderParams,
		},
	}),
	create: helperApiInputDocumentation({
		description: 'Ask to return items of an own order',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Return requested',
			dataSample: {
				id: 7,
				ref_code: 'RMA',
				ref_number: 7,
				status: OrderReturnStatusEnum.REQUESTED,
			},
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `The order must be confirmed or completed, and the request made within ${Configuration.get('orderReturn.windowDays')} days of its last delivery (409). Each line is capped by what was delivered and is not already being returned (409); a variant not on the order is 422. The request is reviewed by the shop - nothing is collected or refunded until it is approved`,
			params: orderParams,
			body: {
				reason: {
					type: 'enum',
					required: true,
					values: Object.values(OrderReturnReasonEnum),
				},
				customer_notes: {
					type: 'string',
					required: false,
					condition: `up to ${ORDER_RETURN_NOTES_MAX} characters`,
				},
				lines: {
					type: 'array',
					required: true,
					format: '[{ variant_id: number; quantity: number }]',
				},
			},
			sample: {
				reason: OrderReturnReasonEnum.WRONG_ITEM,
				customer_notes: 'Ordered M, received L',
				lines: [{ variant_id: 27, quantity: 1 }],
			},
		},
	}),
	cancel: helperApiInputDocumentation({
		description: 'Withdraw an own return request',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return request withdrawn',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: `Only while ${OrderReturnStatusEnum.REQUESTED} - once the shop has decided, 409`,
			params: {
				...orderParams,
				id: { type: 'number', required: true },
			},
		},
	}),
};
