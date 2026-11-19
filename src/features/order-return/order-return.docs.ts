import { Configuration } from '@/config/settings.config';
import type { orderReturnController } from '@/features/order-return/order-return.controller';
import {
	MANUAL_STATUSES,
	OrderReturnReasonEnum,
	OrderReturnStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/order-return/order-return.entity';
import {
	ORDER_RETURN_LINES_MAX,
	ORDER_RETURN_NOTES_MAX,
	OrderByEnum,
	paramsUpdateList,
} from '@/features/order-return/order-return.validator';
import {
	ShippingMethodEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/** Written out rather than taken from the mock: a return is read with its lines attached. */
const lineSample: Record<string, unknown> = {
	id: 31,
	order_return_id: 7,
	variant_id: 27,
	product_id: 12,
	quantity: 1,
	sku: 'OXF-M-BLUE',
	label: 'Oxford shirt',
	created_at: '2026-11-12T10:15:00.000Z',
	updated_at: null,
	deleted_at: null,
};

const refundShippingParam = {
	type: 'boolean',
	required: false,
	condition:
		'pay back the outbound delivery fee with the goods; read when the refund is drafted',
} as const;

const entrySample: Record<string, unknown> = {
	id: 7,
	ref_code: 'RMA',
	ref_number: 7,
	status: OrderReturnStatusEnum.APPROVED,
	reason: OrderReturnReasonEnum.WRONG_ITEM,
	customer_notes: 'Ordered M, received L',
	response: 'Approved - the courier will collect it',
	notes: null,
	decided_at: '2026-11-12T14:02:00.000Z',
	received_at: null,
	closed_at: null,
	reversal_invoice_ids: [],
	refund_shipping: true,
	order_id: 118,
	shipping_id: 64,
	user_id: 42,
	order: { id: 118, ref_code: 'ORD', ref_number: 118, client_id: 9 },
	shipping: {
		id: 64,
		status: ShippingStatusEnum.PENDING,
		destination_warehouse_id: 1,
		tracking_number: null,
		tracking_url: null,
		shipped_at: null,
		delivered_at: null,
	},
	created_at: '2026-11-12T10:15:00.000Z',
	updated_at: '2026-11-12T14:02:00.000Z',
	deleted_at: null,
};

/** Rendered as `requested -> approved | rejected | canceled`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.length ? to.join(' | ') : '(none)'}`)
	.join('; ');

const linesParam = {
	type: 'array' as const,
	required: true,
	format: '[{ variant_id: number; quantity: number }]',
	condition: `1 to ${ORDER_RETURN_LINES_MAX} lines, one per variant; each variant must be on the order, and the quantity within what was delivered and is not already being returned (2 decimals). The product is taken from the order line`,
};

const textParam = (what: string) => ({
	type: 'string' as const,
	required: false,
	condition: `${what}, up to ${ORDER_RETURN_NOTES_MAX} characters`,
});

const idParams = {
	id: { type: 'number' as const, required: true },
};

/**
 * A return carries the request and the decision; the goods move on a `return` shipping movement
 * and the money on invoice reversals. The docs say, per action, which of those it touches.
 */
export const docs: Record<
	keyof typeof orderReturnController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Raise a return for a client',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Return created successfully',
			dataSample: {
				...entrySample,
				status: OrderReturnStatusEnum.REQUESTED,
			},
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `A new return is ${OrderReturnStatusEnum.REQUESTED} and moves nothing; its number is allocated from the RMA series. The order must be confirmed or completed (409). Unlike the storefront, the back office is not held to the ${Configuration.get('orderReturn.windowDays')}-day window after delivery`,
			body: {
				order_id: { type: 'number', required: true },
				reason: {
					type: 'enum',
					required: true,
					values: Object.values(OrderReturnReasonEnum),
				},
				customer_notes: textParam('what the client said'),
				notes: textParam('internal, never shown to the client'),
				lines: linesParam,
			},
			sample: {
				order_id: 118,
				reason: OrderReturnReasonEnum.WRONG_ITEM,
				customer_notes: 'Ordered M, received L',
				lines: [{ variant_id: 27, quantity: 1 }],
			},
		},
	}),
	returnable: helperApiInputDocumentation({
		description: 'What of an order can still be returned',
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Per variant, what is delivered and not yet being returned',
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
		withErrors: [422],
		request: {
			notes: 'Delivered = lines of the delivered deliveries of the order. Taken off: lines of live return movements, and of returns still requested. deadline is the last delivery plus the window - null while nothing has arrived',
			params: { order_id: { type: 'number', required: true } },
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get return details, with its lines',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return details',
			dataSample: { ...entrySample, lines: [lineSample] },
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'lines are what was asked for; what travels is the lines of the return movement (shipping_id). A deleted return is only visible to a caller holding order-return delete',
			params: idParams,
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update return',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return updated successfully',
			dataSample: entrySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Provide at least one of ${paramsUpdateList.join(', ')}. While ${OrderReturnStatusEnum.REQUESTED} everything may change, lines re-checked against what is left; once decided only the notes and the response (409 otherwise) - the movement holds what travels. refund_shipping changes until the refund is drafted, on a return not rejected or canceled (409)`,
			params: idParams,
			body: {
				reason: {
					type: 'enum',
					required: false,
					values: Object.values(OrderReturnReasonEnum),
				},
				customer_notes: textParam('what the client said'),
				response: textParam('what the client is told'),
				notes: textParam('internal'),
				lines: { ...linesParam, required: false },
				refund_shipping: refundShippingParam,
			},
			sample: { response: 'Please pack the item in its original box' },
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete return',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return deleted successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: `Soft delete, for a return that moved nothing - ${OrderReturnStatusEnum.REQUESTED}, ${OrderReturnStatusEnum.REJECTED} or ${OrderReturnStatusEnum.CANCELED}. An approved one answers 409`,
			params: idParams,
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore return',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return restored successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: 'A restored request claims its lines again - 409 when another return took them meanwhile',
			params: idParams,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get returns',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return list',
			dataSample: {
				entries: [entrySample],
				pagination: { page: 1, limit: 10, total: 1 },
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.DESC,
					limit: 10,
					page: 1,
					filter: {
						status: OrderReturnStatusEnum.REQUESTED,
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
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
					id: { type: 'number', required: false },
					order_id: { type: 'number', required: false },
					status: {
						type: 'enum',
						required: false,
						values: Object.values(OrderReturnStatusEnum),
					},
					reason: {
						type: 'enum',
						required: false,
						values: Object.values(OrderReturnReasonEnum),
					},
					create_date_start: { type: 'string', required: false },
					create_date_end: { type: 'string', required: false },
					term: {
						type: 'string',
						required: false,
						condition:
							'the number in its series, the id, or a written reference such as RMA-7',
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
		},
	}),
	approve: helperApiInputDocumentation({
		description: 'Approve a return and create its return shipment',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return approved - the return shipment was created',
			dataSample: entrySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only from ${OrderReturnStatusEnum.REQUESTED}. Writes a return shipping movement in the same transaction, lines copied from the request and capped by what was delivered (409). Pickup defaults to the address the last delivery went to (400 when there is none - state pickup_client_address_id), currency to that delivery's. Free to the client unless price and vat_rate are stated together; the operational cost comes from the rate table. When the movement is received (every line needs a condition) the stock goes back and the return moves to ${OrderReturnStatusEnum.RECEIVED} with its refund drafted`,
			params: idParams,
			body: {
				destination_warehouse_id: {
					type: 'number',
					required: false,
					condition:
						'left out, the warehouse the delivered goods left from; a stated one must have sent every stock-tracked line (409)',
				},
				pickup_client_address_id: { type: 'number', required: false },
				carrier_id: { type: 'number', required: false },
				method: {
					type: 'enum',
					required: false,
					values: Object.values(ShippingMethodEnum),
					default: ShippingMethodEnum.COURIER,
				},
				price: {
					type: 'number',
					required: false,
					condition:
						'net, with vat_rate; left out the return is free',
				},
				vat_rate: { type: 'number', required: false },
				response: textParam('what the client is told'),
				refund_shipping: refundShippingParam,
			},
			sample: {
				carrier_id: 3,
				refund_shipping: true,
				response: 'Approved - the courier will collect it',
			},
		},
	}),
	refund: helperApiInputDocumentation({
		description: 'Draft the refund of a received return',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Refund drafted - issue the reversal to pay it back',
			dataSample: { reversal_invoice_ids: [212] },
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: `Raised automatically when the return is received; this action raises it again when that failed or found nothing. Only once ${OrderReturnStatusEnum.RECEIVED} or ${OrderReturnStatusEnum.CLOSED}, and only while no draft is recorded (409). Drafts one quantity reversal per issued invoice of the order, for what the return movement carried, and - with refund_shipping - one value reversal per issued delivery fee document (by value, so the delivery stays billed and is never charged again); issuing a draft is what refunds the client. 409 when nothing was billed to take back`,
			params: idParams,
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Reject, cancel or close a return',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Return status updated successfully',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409],
		request: {
			notes: `The route takes ${MANUAL_STATUSES.join(', ')}; ${OrderReturnStatusEnum.APPROVED} goes through /approve and ${OrderReturnStatusEnum.RECEIVED} follows the return movement. Allowed moves: ${statusTransitionNote}. Canceling an approved return withdraws its movement while it has not left the client - 409 once it has shipped`,
			params: {
				id: { type: 'number', required: true },
				status: {
					type: 'enum',
					required: true,
					values: [...MANUAL_STATUSES],
				},
			},
			body: {
				response: textParam('what the client is told'),
			},
		},
	}),
};
