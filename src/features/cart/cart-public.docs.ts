import { PRICING_NOTE } from '@/features/cart/cart.docs';
import {
	getCartEntityMock,
	getCartPricingMock,
} from '@/features/cart/cart.mock';
import {
	CART_COMPONENTS_MAX,
	CART_NOTES_MAX,
	CART_OPTIONS_MAX,
	CART_QUANTITY_MAX,
	paramsItemUpdateList,
} from '@/features/cart/cart.validator';
import type { cartPublicController } from '@/features/cart/cart-public.controller';
import { CART_TOKEN_HEADER } from '@/features/cart/cart-public.controller';
import { OrderPaymentMethodEnum } from '@/features/order/order.entity';
import { ShippingMethodEnum } from '@/features/order-shipping/order-shipping.entity';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/**
 * What the storefront gets back from every cart call: the row plus its priced lines. The same
 * shape on a write as on a read, because the totals move on any change - a discount conditioned on
 * the basket value can switch on when one line is added - so returning only the line that changed
 * would leave the client guessing at the total.
 */
const cartSample: Record<string, unknown> = {
	...(getCartEntityMock() as unknown as Record<string, unknown>),
	pricing: getCartPricingMock(),
};

const TOKEN_NOTE = `A guest names their cart with the \`${CART_TOKEN_HEADER}\` header, whose value comes from the \`token\` field of any cart response - it is returned in the body rather than set as a cookie, matching how this API hands out its access token. A signed-in caller is addressed by their account instead and the header is ignored: one cart per account, so a stale handle from another device cannot write past it. Signing in with a guest cart folds it into the account's own, summing the quantities on lines both held - the guest cart is deleted at that point and its handle stops resolving, so the token from the next response is the one to keep`;

/**
 * The storefront half. No permission, and no account except at checkout - a guest filling a basket
 * is the case this feature exists for.
 */
export const docs: Record<
	keyof typeof cartPublicController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get the current cart',
		success: {
			status: 200,
			description: 'The cart and what it currently costs',
			dataSample: cartSample,
		},
		withErrors: [422],
		request: {
			notes: `Creates a cart and returns its \`token\` when the caller has none, so a first page load needs no separate call. Never cached. ${TOKEN_NOTE}. ${PRICING_NOTE}`,
		},
	}),

	addItem: helperApiInputDocumentation({
		description: 'Add a line to the cart',
		success: {
			status: 200,
			description: 'The cart, repriced, with the line added',
			dataSample: cartSample,
			withMessage: true,
		},
		withErrors: [400, 404, 422],
		request: {
			notes: `Adding the same variant with the same options again raises the quantity of the line already holding it rather than creating a second one; the option ids are sorted and de-duplicated first, so the order they are sent in does not matter. A different option set is a different line. This is the only write that may create a cart. ${TOKEN_NOTE}`,
			body: {
				variant_id: {
					type: 'number',
					required: true,
					condition:
						'the purchasable unit; every line names exactly one',
				},
				product_id: {
					type: 'number',
					required: true,
					condition:
						"must be the variant's own product - the pair is held by a composite foreign key, so a mismatch is refused by the database",
				},
				quantity: {
					type: 'number',
					required: true,
					condition: `greater than 0 and at most ${CART_QUANTITY_MAX}; up to two decimals, since a product may be sold by kg or litre`,
				},
				options: {
					type: 'array',
					required: false,
					condition: `product option ids, at most ${CART_OPTIONS_MAX}; they must belong to the product being added, and every question the product asks has to receive between its min_select and max_select answers - otherwise 400`,
				},
				components: {
					type: 'array',
					required: false,
					condition: `what was chosen inside a bundle, at most ${CART_COMPONENTS_MAX}, each \`{ item_id, units? }\` naming a product_bundle_item. Only the decisions: a component that always comes with the kit is resolved from the catalog and naming one is refused, \`units\` applies to an optional tick box and is bounded by its own quantity, and every choice group must receive exactly one candidate. Accepted only on a bundle, and required when the bundle has choices to make - otherwise 400. The bundle is stored as a header line plus one line per component, and priced with the bundle's price apportioned across them at their own VAT rates`,
				},
				notes: {
					type: 'string',
					required: false,
					condition: `at most ${CART_NOTES_MAX} characters`,
				},
			},
		},
	}),

	updateItem: helperApiInputDocumentation({
		description: 'Change a cart line',
		success: {
			status: 200,
			description: 'The cart, repriced, with the line changed',
			dataSample: cartSample,
			withMessage: true,
		},
		withErrors: [404, 422],
		request: {
			notes: `Only ${paramsItemUpdateList.join(' and ')} may change. The options are not editable - a different option set is a different line, so the client removes and re-adds instead. ${TOKEN_NOTE}`,
			params: {
				id: {
					type: 'number',
					required: true,
					condition:
						"the line id, resolved within the caller's own cart",
				},
			},
			body: {
				quantity: {
					type: 'number',
					required: false,
					condition: `greater than 0 and at most ${CART_QUANTITY_MAX}`,
				},
				notes: {
					type: 'string',
					required: false,
					condition: `at most ${CART_NOTES_MAX} characters`,
				},
			},
		},
	}),

	removeItem: helperApiInputDocumentation({
		description: 'Remove a cart line',
		success: {
			status: 200,
			description: 'The cart, repriced, without the line',
			dataSample: cartSample,
			withMessage: true,
		},
		withErrors: [404, 422],
		request: {
			notes: `The line is deleted outright - what a shopper took out of a basket is not a record anybody keeps. ${TOKEN_NOTE}`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),

	clear: helperApiInputDocumentation({
		description: 'Empty the cart',
		success: {
			status: 200,
			description: 'The cart, now empty',
			dataSample: cartSample,
			withMessage: true,
		},
		withErrors: [404],
		request: {
			notes: `Emptying an already-empty cart succeeds - the caller asked for a state, not for a row to exist. The cart itself survives, so its token stays usable. ${TOKEN_NOTE}`,
		},
	}),

	setCurrency: helperApiInputDocumentation({
		description: 'Reprice the cart into another currency',
		success: {
			status: 200,
			description: 'The cart, repriced into the new currency',
			dataSample: cartSample,
			withMessage: true,
		},
		withErrors: [404, 422],
		request: {
			notes: `One column changes and the whole basket is re-read against the new market, because no line stores money. A currency the catalog carries no price in is not refused here - the affected lines come back with \`issue: no_price\`, which tells the shopper more than a rejection of the code would. ${TOKEN_NOTE}`,
			body: {
				currency: {
					type: 'string',
					required: true,
					condition: 'three-letter ISO code',
				},
			},
		},
	}),

	checkout: helperApiInputDocumentation({
		description: 'Turn the cart into an order',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'The order the cart became',
			dataSample: {
				order_id: 104,
				ref_code: 'ORD',
				ref_number: 1183,
				status: 'pending',
				issued_at: new Date().toISOString(),
			},
			withMessage: true,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: "Requires an account: the order names a `client` to invoice, and it has to be one of the caller's own - listed by `GET /public/clients`, added by `POST /public/clients`. Somebody else's client answers 404, exactly as a missing one does. Prices are resolved once more here rather than reused from whatever the shopper was last shown, and those are the figures written to the order - so this is the moment they stop moving. An empty cart answers 400, and so does a cart with any line carrying an `issue`. The delivery choice is written as the order's first `order_shipping` row, leaving from the active default warehouse at no charge and carrying the client's contact details - 409 when no default warehouse is configured. The cart is deleted once the order is written, in the same transaction and with its lines - the order is the record of what was bought, and the next visit starts a fresh cart with a new token",
			body: {
				client_id: {
					type: 'number',
					required: true,
					condition:
						"who the order is billed to; one of the caller's own clients",
				},
				delivery_method: {
					type: 'enum',
					required: true,
					values: Object.values(ShippingMethodEnum),
				},
				billing_address_id: {
					type: 'number',
					required: true,
					condition:
						'a `billing` address filed under client_id (`GET /public/client-addresses`); copied onto the order as `billing_details`',
				},
				delivery_address_id: {
					type: 'number',
					required: false,
					condition: `a \`delivery\` address filed under client_id; required when delivery_method is ${ShippingMethodEnum.COURIER}, ignored for ${ShippingMethodEnum.SELF_PICKUP}; copied onto the shipment`,
				},
				payment_method: {
					type: 'enum',
					required: true,
					values: Object.values(OrderPaymentMethodEnum),
				},
				notes: {
					type: 'string',
					required: false,
					condition: `at most ${CART_NOTES_MAX} characters; recorded on the order`,
				},
			},
		},
	}),
};
