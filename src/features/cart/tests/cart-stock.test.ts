import { expect, jest } from '@jest/globals';
import {
	type CartLine,
	CartLineIssueEnum,
	CartPricingService,
} from '@/features/cart/cart-pricing.service';
import {
	registerStockAvailabilityResolver,
	type VariantAvailability,
} from '@/shared/registries/stock-availability.registry';

function line(overrides: Partial<CartLine>): CartLine {
	return {
		id: 1,
		parent_id: null,
		bundle_item_id: null,
		is_bundle: false,
		variant_id: 7,
		product_id: 3,
		sku: null,
		label: null,
		slug: null,
		quantity: 1,
		notes: null,
		unit_price: 10,
		base_price: 10,
		options: [],
		vat_rate: 21,
		subtotal: 10,
		discount_reduction: 0,
		discount: null,
		total: 10,
		vat_amount: 2.1,
		stock_available: null,
		issue: null,
		...overrides,
	};
}

function stock(
	available: number,
	overrides: Partial<VariantAvailability> = {},
): VariantAvailability {
	return {
		available: available,
		allow_backorder: false,
		low_stock_threshold: null,
		...overrides,
	};
}

describe('CartPricingService - applyStock', () => {
	const service = new CartPricingService(
		{} as never,
		{} as never,
		{} as never,
	);

	const applyStock = (lines: CartLine[]) =>
		(
			service as unknown as {
				applyStock(lines: CartLine[]): Promise<CartLine[]>;
			}
		).applyStock(lines);

	/** Answers the availability the cart asks `warehouse-movement` for. */
	const answering = (availability: Record<number, VariantAvailability>) => {
		const resolver = jest.fn(
			async (variantIds: readonly number[]) =>
				new Map(
					variantIds.flatMap((id) =>
						availability[id]
							? [[id, availability[id]] as const]
							: [],
					),
				),
		);

		registerStockAvailabilityResolver(resolver);

		return resolver;
	};

	afterEach(() => {
		registerStockAvailabilityResolver(null);
	});

	const issues = (lines: CartLine[]) =>
		Object.fromEntries(lines.map((entry) => [entry.id, entry.issue]));

	// 2 + 2 of one variant against 3 left: each line fits alone, the basket does not
	it('judges a variant on what the whole basket asks of it', async () => {
		answering({ 7: stock(3) });

		const priced = await applyStock([
			line({ id: 1, quantity: 2 }),
			line({ id: 2, quantity: 2 }),
		]);

		expect(issues(priced)).toEqual({
			1: CartLineIssueEnum.INSUFFICIENT_STOCK,
			2: CartLineIssueEnum.INSUFFICIENT_STOCK,
		});
		expect(priced.map((entry) => entry.stock_available)).toEqual([3, 3]);
	});

	it('takes a whole bundle down when one component is short', async () => {
		answering({ 7: stock(5), 8: stock(0) });

		const priced = await applyStock([
			line({
				id: 10,
				is_bundle: true,
				variant_id: 50,
				unit_price: 0,
				subtotal: 0,
			}),
			line({ id: 11, parent_id: 10, variant_id: 7 }),
			line({ id: 12, parent_id: 10, variant_id: 8 }),
			line({ id: 20, variant_id: 7 }),
		]);

		expect(issues(priced)).toEqual({
			10: CartLineIssueEnum.INSUFFICIENT_STOCK,
			11: CartLineIssueEnum.INSUFFICIENT_STOCK,
			12: CartLineIssueEnum.INSUFFICIENT_STOCK,
			// The same variant bought on its own is not short - only its bundle is
			20: null,
		});
		// A header holds no stock and never states a count
		expect(
			priced.find((entry) => entry.id === 10)?.stock_available,
		).toBeNull();
	});

	// A bundle header names its own variant, which holds no stock and is never asked about
	it('never asks about a bundle header', async () => {
		const resolver = answering({ 7: stock(5) });

		await applyStock([
			line({ id: 10, is_bundle: true, variant_id: 50 }),
			line({ id: 11, parent_id: 10, variant_id: 7 }),
		]);

		expect(resolver).toHaveBeenCalledWith([7]);
	});

	it('lets a backorder variant through, whatever is left', async () => {
		answering({ 7: stock(-2, { allow_backorder: true }) });

		const [priced] = await applyStock([line({ quantity: 5 })]);

		expect(priced.issue).toBeNull();
		expect(priced.stock_available).toBeNull();
	});

	it('states the count at or under the low-stock threshold, floored at zero', async () => {
		answering({
			7: stock(4, { low_stock_threshold: 5 }),
			8: stock(-1, { allow_backorder: true, low_stock_threshold: 0 }),
			9: stock(40, { low_stock_threshold: 5 }),
		});

		const priced = await applyStock([
			line({ id: 1, variant_id: 7 }),
			line({ id: 2, variant_id: 8 }),
			line({ id: 3, variant_id: 9 }),
		]);

		expect(priced.map((entry) => entry.stock_available)).toEqual([
			4,
			0,
			null,
		]);
		expect(priced.every((entry) => entry.issue === null)).toBe(true);
	});

	// Absent from the map is how the cart tells untracked from "none left"
	it('treats a variant the resolver leaves out as never short', async () => {
		answering({});

		const [priced] = await applyStock([line({ quantity: 999 })]);

		expect(priced.issue).toBeNull();
	});

	it('keeps an earlier issue rather than overwriting it', async () => {
		const resolver = answering({ 7: stock(0) });

		const [priced] = await applyStock([
			line({ issue: CartLineIssueEnum.NO_PRICE }),
		]);

		expect(priced.issue).toBe(CartLineIssueEnum.NO_PRICE);
		expect(resolver).not.toHaveBeenCalled();
	});
});
