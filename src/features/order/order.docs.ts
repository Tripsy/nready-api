import { Configuration } from '@/config/settings.config';
import type { orderController } from '@/features/order/order.controller';
import {
	OrderStatusEnum,
	OrderTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/order/order.entity';
import { ORDER_LINES_MAX, OrderByEnum } from '@/features/order/order.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * The document as `find` returns it - the order row with the client joined, and no lines: a
 * listing names the counterparty and the reference, and loading every line of every row to do it
 * would be the query's whole cost.
 */
export const orderSample: Record<string, unknown> = {
	id: 118,
	client_id: 7,
	ref_code: 'ORD',
	ref_number: 1183,
	status: OrderStatusEnum.CONFIRMED,
	type: OrderTypeEnum.STANDARD,
	issued_at: '2026-08-14T11:32:00.000Z',
	notes: null,
	created_at: '2026-08-14T11:32:00.000Z',
	updated_at: null,
	deleted_at: null,
	client: {
		id: 7,
		client_type: 'company',
		status: 'active',
		company_name: 'Tripsy SRL',
		person_name: null,
		contact_email: 'office@example.com',
	},
};

/** What `read` adds on top: the lines, and what they add up to. */
export const orderWithLinesSample: Record<string, unknown> = {
	...orderSample,
	lines: [
		{
			id: 402,
			order_id: 118,
			parent_id: null,
			variant_id: 91,
			product_id: 44,
			quantity: 2,
			price: 45,
			vat_rate: 11,
			currency: 'RON',
			exchange_rate: 1,
			discount: null,
			discount_reduction: 0,
			options: null,
			notes: null,
			variant: {
				id: 91,
				sku: 'PIZZA-MARG-32',
			},
			label: 'Pizza Margherita',
		},
	],
	totals: {
		currency: 'RON',
		exchange_rate: 1,
		subtotal: 90,
		discount_reduction: 0,
		order_discount_reduction: 0,
		vat_amount: 9.9,
		total: 99.9,
		has_discount: false,
	},
};

/** Rendered as `pending -> confirmed | canceled`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ') || '(terminal)'}`)
	.join('; ');

export const totalsNote =
	"`totals` sums `price x quantity` per line as `subtotal`, before any discount, and states what the discounts took off beside it as `discount_reduction`; VAT is charged per line on the difference, at that line's own rate, and `total` is `subtotal - discount_reduction + vat_amount`. `order_discount_reduction` says how much of that reduction came from an order-wide campaign rather than from the lines' own rules - it is **already inside** `discount_reduction`, stated separately so a reader can see what the campaign was worth, never to be subtracted a second time";

const lineNote = `Each line names a variant and the product it belongs to - the pair is checked before the insert, so a mismatch answers 400 rather than a constraint violation. Prices are the caller's: the order records the figure that was agreed. Discounts are not - the catalog's own rules are resolved over the set as it is saved, clamped against \`product_price.min_price\`, and written to the line as snapshots plus the money they took off. A line carries its own best discount and, stacked on top, its apportioned share of any order-wide campaign, each snapshot stating what it alone was worth; \`discount_reduction\` is their sum and the figure VAT is charged on. \`options\` are \`product_option\` ids: each must belong to the line's product and every question on that product must receive between its \`min_select\` and \`max_select\` answers, or the request answers 400. They are stored as snapshots carrying the option id, today's wording and the delta in the document's currency; \`price\` is the unit figure with those deltas already folded in. Up to ${ORDER_LINES_MAX} lines`;

/**
 * An order is the document a business raises against a client. It is created here only for
 * back-office composition - a checkout raises its own through `CartService.toOrder`. Both enter at
 * `pending`.
 *
 * `status` is never part of a create or an update body - it moves only through its own route, and
 * only along the transitions the entity declares.
 */
export const docs: Record<keyof typeof orderController, ApiInputDocumentation> =
	{
		create: helperApiInputDocumentation({
			description: 'Compose a back-office order',
			withBearerAuth: true,
			success: {
				status: 201,
				description: 'Order created successfully',
				dataSample: orderSample,
			},
			withAuthErrors: true,
			withErrors: [400, 404, 422],
			request: {
				notes: `The order starts as \`${OrderStatusEnum.PENDING}\`, exactly as a checkout's order does, and is given its reference straight away, allocated from the \`ORD\` series - an order canceled before confirmation leaves that number spent. A \`client_id\` that resolves to nothing answers 404. The exchange rate is not a field: it is read from the published \`exchange-rate\` series as of \`issued_at\`, and a currency with no rate published answers 400. ${lineNote}`,
				body: {
					client_id: {
						type: 'number',
						required: true,
						condition:
							'must resolve to a client that is not deleted',
					},
					currency: {
						type: 'string',
						required: true,
						condition: 'ISO 4217 code, three letters',
					},
					type: {
						type: 'enum',
						required: false,
						values: Object.values(OrderTypeEnum),
						default: OrderTypeEnum.STANDARD,
					},
					issued_at: {
						type: 'string',
						required: false,
						condition:
							'ISO date; defaults to now, backdating is allowed',
					},
					notes: { type: 'string', required: false },
					lines: {
						type: 'array',
						required: true,
						condition: `1 to ${ORDER_LINES_MAX} entries of { variant_id, product_id, quantity, price, vat_rate, options, notes }; quantity above 0, price and vat_rate from 0, options an optional list of product option ids`,
					},
				},
				sample: {
					client_id: 7,
					currency: 'RON',
					lines: [
						{
							variant_id: 91,
							product_id: 44,
							quantity: 2,
							price: 53,
							vat_rate: 11,
							options: [301],
						},
					],
				},
			},
		}),
		read: helperApiInputDocumentation({
			description: 'Get order details',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Order details, with its client, lines and totals',
				dataSample: orderWithLinesSample,
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				notes: `A deleted order is only visible to a caller holding order delete. ${totalsNote}`,
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
			},
		}),
		update: helperApiInputDocumentation({
			description: 'Update order',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Order updated successfully',
				dataSample: orderSample,
			},
			withAuthErrors: true,
			withErrors: [400, 404, 409, 422],
			request: {
				notes: `Provide at least one of client_id, currency, type, issued_at, notes or lines. A \`status\` in the body is ignored - it has its own route. **\`lines\` replaces the whole set and is accepted only while the order is \`${OrderStatusEnum.PENDING}\`** - checkout orders included; on any other status it answers 409, because the business has accepted what the document says. Every line re-states its \`options\` as ids and they are re-resolved from the catalog, so a checkout line keeps its options only when they are sent back. \`currency\` is refused without \`lines\`: no order row holds a currency - each line carries its own - so re-denominating a document means re-stating its prices in the new one, and nothing here converts a figure. Its rate is read from the published \`exchange-rate\` series as of the order's \`issued_at\`, never taken from the body`,
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
				body: {
					client_id: { type: 'number', required: false },
					currency: {
						type: 'string',
						required: false,
						condition:
							'ISO 4217 code, three letters; only together with lines',
					},
					type: {
						type: 'enum',
						required: false,
						values: Object.values(OrderTypeEnum),
					},
					issued_at: { type: 'string', required: false },
					notes: { type: 'string', required: false },
					lines: {
						type: 'array',
						required: false,
						condition: 'pending only; replaces every existing line',
					},
				},
				sample: {
					notes: 'Customer asked for delivery after 18:00',
				},
			},
		}),
		delete: helperApiInputDocumentation({
			description: 'Delete order',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Order deleted with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				notes: 'Soft delete, whatever the status. The reference is released with it - `IDX_order_ref` ignores deleted rows - but the series counter does not move back, so the number is not handed out again',
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
			},
		}),
		restore: helperApiInputDocumentation({
			description: 'Restore order',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Order restored with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
			},
		}),
		find: helperApiInputDocumentation({
			description: 'Get orders',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Order list',
				dataSample: {
					entries: [orderSample],
					pagination: {
						page: 1,
						limit: 5,
						total: 0,
					},
					query: {
						order_by: OrderByEnum.ISSUED_AT,
						direction: OrderDirectionEnum.DESC,
						limit: 5,
						page: 1,
						filter: {
							term: 'ORD-1183',
							status: OrderStatusEnum.CONFIRMED,
							is_deleted: false,
						},
					},
				},
			},
			withAuthErrors: true,
			withErrors: [422],
			request: {
				notes: 'The listing joins the client but not the lines - read one order to get those',
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
						default: OrderByEnum.ISSUED_AT,
					},
					direction: {
						type: 'enum',
						required: false,
						values: Object.values(OrderDirectionEnum),
						default: OrderDirectionEnum.DESC,
					},
					filter: {
						id: { type: 'number', required: false },
						client_id: { type: 'number', required: false },
						term: {
							type: 'string',
							required: false,
							condition:
								'a whole reference (`ORD-1183`) matches both halves; an all-digit term matches the id or the document number; otherwise the series code',
						},
						ref_code: { type: 'string', required: false },
						ref_number: { type: 'number', required: false },
						status: {
							type: 'enum',
							required: false,
							values: Object.values(OrderStatusEnum),
						},
						type: {
							type: 'enum',
							required: false,
							values: Object.values(OrderTypeEnum),
						},
						issued_at_start: { type: 'string', required: false },
						issued_at_end: { type: 'string', required: false },
						is_deleted: {
							type: 'boolean',
							required: false,
							default: false,
							condition:
								'only honored for a caller holding order delete',
						},
					},
				},
			},
		}),
		statusUpdate: helperApiInputDocumentation({
			description: 'Update order status',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Order status updated successfully',
			},
			withAuthErrors: true,
			withErrors: [400, 404, 409, 422],
			request: {
				notes: `Allowed moves: ${statusTransitionNote}. Nothing returns to \`${OrderStatusEnum.PENDING}\`, and \`${OrderStatusEnum.COMPLETED}\` is terminal - a fulfilled order that goes wrong is corrected on the money, not on the document. Repeating the current status answers 400, an illegal move 409`,
				params: {
					id: {
						type: 'number',
						required: true,
					},
					status: {
						type: 'enum',
						required: true,
						values: Object.values(OrderStatusEnum),
					},
				},
			},
		}),
	};
