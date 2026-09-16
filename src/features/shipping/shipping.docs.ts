import { Configuration } from '@/config/settings.config';
import type { shippingController } from '@/features/shipping/shipping.controller';
import {
	ShippingMethodEnum,
	ShippingScopeEnum,
	ShippingStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/shipping/shipping.entity';
import { OrderByEnum } from '@/features/shipping/shipping.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Written out rather than taken from a mock, which this feature does not have. `read` joins the
 * order, both warehouse ends and the carrier, and attaches the lines - the columns alone are not
 * what the endpoint returns.
 */
const entitySample: Record<string, unknown> = {
	id: 1,
	scope: ShippingScopeEnum.DELIVERY,
	order_id: 12,
	document_ref: null,
	status: ShippingStatusEnum.PREPARING,
	method: ShippingMethodEnum.COURIER,
	carrier_id: 2,
	pickup_warehouse_id: 1,
	pickup_client_address_id: null,
	destination_warehouse_id: null,
	destination_client_address_id: 7,
	pickup_data: null,
	destination_data: null,
	tracking_number: null,
	tracking_url: null,
	vat_rate: 0,
	price: 0,
	operational_cost: null,
	currency: 'RON',
	exchange_rate: 1,
	contact_name: 'Ana Popescu',
	contact_phone: '+40721000000',
	contact_email: 'ana@example.com',
	shipped_at: null,
	delivered_at: null,
	estimated_delivery_at: null,
	notes: null,
	created_at: '2026-09-02T09:14:00.000Z',
	updated_at: null,
	deleted_at: null,
	lines: [
		{
			id: 3,
			shipping_id: 1,
			variant_id: 55,
			product_id: 18,
			quantity: 2,
			notes: null,
			sku: 'TSHIRT-RED-M',
			label: 'Cotton T-shirt',
		},
	],
};

/** Rendered as `pending -> preparing | failed`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ') || 'nothing'}`)
	.join('; ');

const scopeNote = `scope decides what every other reference means, and cannot be changed afterwards. ${ShippingScopeEnum.DELIVERY}: pickup_warehouse_id to destination_client_address_id, against order_id. ${ShippingScopeEnum.RELOCATION}: pickup_warehouse_id to destination_warehouse_id, against document_ref - the relocation document has no table yet, so that one is a bare id with no key behind it. ${ShippingScopeEnum.RETURN}: pickup_client_address_id to destination_warehouse_id, against order_id. The two ends and the document its scope needs are all required; anything belonging to another scope is dropped rather than stored`;

const endsNote = `Both ends are frozen into pickup_data and destination_data when the movement reaches ${ShippingStatusEnum.SHIPPED}, and neither can be moved after that (409)`;

const allocationNote =
	'lines say what physically travels, by variant and quantity. On a movement with an order behind it, each variant must appear on that order (400 otherwise) and the quantity may not exceed what the order still has unshipped for that variant across its other movements (409) - counted per variant, since a line names no order line. A relocation is measured against stock on hand instead and is not checked here. Sending lines replaces the whole set';

/**
 * A movement of goods: out to a client, between two warehouses, or back from a client.
 *
 * **A document may have several.** The goods of one order can sit in two places, so the site they
 * leave from is recorded per movement, and `shipping_line` says what travelled in which.
 *
 * `status` is never part of a create or an update body - it moves only through its own route, and
 * only along the transitions the entity declares.
 */
export const docs: Record<
	keyof typeof shippingController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a movement of goods',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Movement created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `A new movement starts as ${ShippingStatusEnum.PENDING}. ${scopeNote}. An order_id, warehouse, address or carrier_id that resolves to nothing answers 404. ${allocationNote}`,
			body: {
				scope: {
					type: 'enum',
					required: true,
					values: Object.values(ShippingScopeEnum),
				},
				method: {
					type: 'enum',
					required: true,
					values: Object.values(ShippingMethodEnum),
				},
				order_id: {
					type: 'number',
					required: false,
					condition: `required for ${ShippingScopeEnum.DELIVERY} and ${ShippingScopeEnum.RETURN}`,
				},
				document_ref: {
					type: 'number',
					required: false,
					condition: `required for ${ShippingScopeEnum.RELOCATION}; no table behind it yet`,
				},
				pickup_warehouse_id: {
					type: 'number',
					required: false,
					condition: `required for ${ShippingScopeEnum.DELIVERY} and ${ShippingScopeEnum.RELOCATION}`,
				},
				pickup_client_address_id: {
					type: 'number',
					required: false,
					condition: `required for ${ShippingScopeEnum.RETURN}`,
				},
				destination_warehouse_id: {
					type: 'number',
					required: false,
					condition: `required for ${ShippingScopeEnum.RELOCATION} and ${ShippingScopeEnum.RETURN}`,
				},
				destination_client_address_id: {
					type: 'number',
					required: false,
					condition: `required for ${ShippingScopeEnum.DELIVERY}`,
				},
				carrier_id: { type: 'number', required: false },
				tracking_number: { type: 'string', required: false },
				tracking_url: { type: 'string', required: false },
				price: { type: 'number', required: true },
				operational_cost: {
					type: 'number',
					required: false,
					condition: 'internal cost in base currency, 0 or more',
				},
				vat_rate: {
					type: 'number',
					required: true,
					condition: '0 to 100',
				},
				currency: {
					type: 'string',
					required: true,
					condition: 'three-letter ISO code',
				},
				contact_name: { type: 'string', required: false },
				contact_phone: { type: 'string', required: false },
				contact_email: { type: 'string', required: false },
				estimated_delivery_at: { type: 'string', required: false },
				notes: { type: 'string', required: false },
				lines: {
					type: 'array',
					required: false,
					condition:
						'each entry: variant_id, product_id, quantity, optional notes',
				},
			},
			sample: {
				scope: ShippingScopeEnum.DELIVERY,
				order_id: 12,
				pickup_warehouse_id: 1,
				destination_client_address_id: 7,
				method: ShippingMethodEnum.COURIER,
				carrier_id: 2,
				price: 0,
				vat_rate: 0,
				currency: 'RON',
				lines: [{ variant_id: 55, product_id: 18, quantity: 2 }],
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get movement details',
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Movement details, with its order, warehouse ends, carrier and lines',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'A deleted movement is only visible to a caller holding shipping delete. The joins are LEFT, so a movement whose carrier was removed still reads',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update movement',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Movement updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Provide at least one updatable field. scope, order_id and document_ref are not among them - the scope is fixed at creation, and moving a movement to another document would take its lines with it. A status in the body is ignored, it has its own route. ${endsNote}. ${allocationNote}`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				method: {
					type: 'enum',
					required: false,
					values: Object.values(ShippingMethodEnum),
				},
				pickup_warehouse_id: { type: 'number', required: false },
				pickup_client_address_id: { type: 'number', required: false },
				destination_warehouse_id: { type: 'number', required: false },
				destination_client_address_id: {
					type: 'number',
					required: false,
				},
				carrier_id: { type: 'number', required: false },
				tracking_number: { type: 'string', required: false },
				tracking_url: { type: 'string', required: false },
				price: { type: 'number', required: false },
				operational_cost: {
					type: 'number',
					required: false,
					condition: 'internal cost in base currency, 0 or more',
				},
				vat_rate: { type: 'number', required: false },
				currency: { type: 'string', required: false },
				contact_name: { type: 'string', required: false },
				contact_phone: { type: 'string', required: false },
				contact_email: { type: 'string', required: false },
				estimated_delivery_at: { type: 'string', required: false },
				notes: { type: 'string', required: false },
				lines: { type: 'array', required: false },
			},
			sample: {
				tracking_number: 'TRK889201',
				lines: [{ variant_id: 55, product_id: 18, quantity: 1 }],
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete movement',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Movement deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Soft delete, whatever the status. A deleted movement releases what it carried, so those quantities become available to the document's other movements",
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore movement',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Movement restored with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'The lines come back with it, which can leave a variant committed beyond what the order holds if another movement claimed it meanwhile - the figures are worth checking after a restore',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get movements',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Movement list',
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
						scope: ShippingScopeEnum.DELIVERY,
						order_id: 12,
						status: ShippingStatusEnum.PREPARING,
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
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
					id: { type: 'number', required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id, the order id or the order document number exactly; an order reference (\`ORD-1183\`) matches that order's shipments or a tracking number containing it; otherwise the tracking number, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					scope: {
						type: 'enum',
						required: false,
						values: Object.values(ShippingScopeEnum),
					},
					order_id: { type: 'number', required: false },
					document_ref: { type: 'number', required: false },
					pickup_warehouse_id: { type: 'number', required: false },
					destination_warehouse_id: {
						type: 'number',
						required: false,
					},
					carrier_id: { type: 'number', required: false },
					status: {
						type: 'enum',
						required: false,
						values: Object.values(ShippingStatusEnum),
					},
					method: {
						type: 'enum',
						required: false,
						values: Object.values(ShippingMethodEnum),
					},
					shipped_at_start: { type: 'string', required: false },
					shipped_at_end: { type: 'string', required: false },
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only honored for a caller holding shipping delete',
					},
				},
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Update movement status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Movement status updated successfully',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Allowed moves: ${statusTransitionNote}. A repeat of the current status answers 400, anything else 409. ${endsNote}, and the same move stamps shipped_at; ${ShippingStatusEnum.DELIVERED} stamps delivered_at. Neither stamp is ever rewritten`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(ShippingStatusEnum),
				},
			},
		},
	}),
};
