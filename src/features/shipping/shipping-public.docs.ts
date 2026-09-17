import {
	ShippingMethodEnum,
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import type { shippingPublicController } from '@/features/shipping/shipping-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/** One movement as the buyer is shown it - see `PUBLIC_ENTRY_COLUMNS` in the service. */
const publicSample: Record<string, unknown> = {
	id: 51,
	scope: ShippingScopeEnum.DELIVERY,
	order_id: 118,
	status: ShippingStatusEnum.SHIPPED,
	method: ShippingMethodEnum.COURIER,
	destination_data: {
		address_country: 'Romania',
		address_region: 'Cluj',
		address_city: 'Cluj-Napoca',
		details: 'Str. Memorandumului 28, ap. 4',
		postal_code: '400114',
		notes: null,
	},
	price: 20.66,
	vat_rate: 21,
	currency: 'RON',
	discount_reduction: 0,
	tracking_number: '1Z999AA10123456784',
	tracking_url: 'https://tracking.example.com/1Z999AA10123456784',
	shipped_at: '2026-08-15T09:10:00.000Z',
	delivered_at: null,
	estimated_delivery_at: '2026-08-17T00:00:00.000Z',
	created_at: '2026-08-14T11:32:00.000Z',
	pickup_warehouse: { id: 1, name: 'Main warehouse' },
	carrier: { id: 3, name: 'Fan Courier' },
};

/**
 * The storefront half: delivery tracking for one of the caller's own orders. Documented as its own
 * module because docs are registered under the route file's own name.
 */
export const docs: Record<
	keyof typeof shippingPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: "The movements of one of the caller's own orders",
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Deliveries and returns against the order, oldest first',
			dataSample: { entries: [publicSample] },
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Requires an account. An order billed to somebody else's client answers 404, the same as a missing one. Unpaginated. `destination_data` is null until the movement ships - the address is frozen at that transition. `pickup_warehouse` is where a `self_pickup` is collected from. `price` excludes VAT; what the client paid is `(price - discount_reduction) x (1 + vat_rate / 100)`",
			params: {
				order_id: { type: 'number', required: true },
			},
		},
	}),
};
