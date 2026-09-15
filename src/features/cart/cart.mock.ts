import type CartEntity from '@/features/cart/cart.entity';
import { OrderByEnum } from '@/features/cart/cart.validator';
import type { CartPricing } from '@/features/cart/cart-pricing.service';
import { createFutureDate, createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/** One cart row, as the dashboard listing returns it. */
export function getCartEntityMock(): CartEntity {
	return {
		id: 9,
		token: '3f1c8b5e-2a44-4f8d-9c11-8d2e6b0a7c34',
		user_id: 7,
		currency: 'RON',
		expires_at: createFutureDate(30 * 24 * 60 * 60),
		created_at: createPastDate(86400),
		updated_at: createPastDate(3600),
	} as unknown as CartEntity;
}

/**
 * What a priced cart looks like on the way out.
 *
 * Every money field here is computed at read time and stored nowhere - which is why the mock has
 * to be written by hand rather than derived from a `cart_item` fixture: there is no column behind
 * any of it. The second line carries an issue, the case a client has to render and the one that
 * blocks checkout.
 */
export function getCartPricingMock(): CartPricing {
	return {
		currency: 'RON',
		lines: [
			{
				id: 31,
				variant_id: 41,
				product_id: 17,
				sku: 'PIZZA-MARG-30',
				label: 'Pizza Margherita',
				slug: 'pizza-margherita',
				quantity: 2,
				notes: null,
				unit_price: 38,
				base_price: 34,
				options: [
					{
						label: 'Stuffed crust',
						price_delta: 4,
						currency: 'RON',
					},
				],
				vat_rate: 11,
				subtotal: 76,
				discount_reduction: 7.6,
				discount: {
					label: 'Autumn 10%',
					scope: 'product',
					reason: null,
					reference: null,
					type: 'percent',
					conditions: null,
					value: 10,
				},
				total: 68.4,
				vat_amount: 7.52,
				issue: null,
			},
			{
				id: 32,
				variant_id: 55,
				product_id: 21,
				sku: 'DESSERT-TIRAMISU',
				label: 'Tiramisu',
				slug: 'tiramisu',
				quantity: 1,
				notes: null,
				unit_price: 0,
				base_price: 0,
				options: [],
				vat_rate: 0,
				subtotal: 0,
				discount_reduction: 0,
				discount: null,
				total: 0,
				vat_amount: 0,
				issue: 'not_sellable',
			},
		],
		subtotal: 76,
		discount_reduction: 7.6,
		vat_amount: 7.52,
		total: 75.92,
		has_issues: true,
	} as unknown as CartPricing;
}

export const cartInputPayloads = {
	addItem: {
		variant_id: 41,
		product_id: 17,
		quantity: 2,
		options: [8],
		notes: null,
	},
	find: {
		page: 1,
		limit: 20,
		order_by: OrderByEnum.UPDATED_AT,
		direction: OrderDirectionEnum.DESC,
		filter: {
			user_id: 7,
		},
	},
};
