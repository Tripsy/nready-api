import type { WarehouseAvailability } from '@/features/cart/cart.hooks';
import {
	type FulfillmentLine,
	planDeliveries,
} from '@/features/cart/cart-fulfillment';

const DEFAULT_SITE = 1;

const line = (variantId: number, quantity = 1): FulfillmentLine => ({
	variant_id: variantId,
	product_id: variantId * 10,
	quantity: quantity,
});

/** `{ variant: { site: stock } }` as the resolver's nested maps. */
const stock = (
	table: Record<number, Record<number, number>>,
): WarehouseAvailability =>
	new Map(
		Object.entries(table).map(([variantId, sites]) => [
			Number(variantId),
			new Map(
				Object.entries(sites).map(([siteId, quantity]) => [
					Number(siteId),
					quantity,
				]),
			),
		]),
	);

/** `{ site: { variant: quantity } }`, in the order the groups came back. */
const summarize = (groups: ReturnType<typeof planDeliveries>) =>
	groups.map((group) => ({
		warehouse_id: group.warehouse_id,
		lines: Object.fromEntries(
			group.lines.map((groupLine) => [
				groupLine.variant_id,
				groupLine.quantity,
			]),
		),
	}));

describe('planDeliveries', () => {
	it('ships everything from the default when it can fill the order', () => {
		const groups = planDeliveries(
			[line(1, 2), line(2)],
			stock({ 1: { 1: 5, 2: 9 }, 2: { 1: 1, 2: 9 } }),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 1, lines: { 1: 2, 2: 1 } },
		]);
	});

	it('ships from one secondary site when it alone can fill the order', () => {
		const groups = planDeliveries(
			[line(1), line(2), line(3)],
			stock({
				1: { 1: 5, 2: 5, 3: 5 },
				2: { 1: 5, 2: 5, 3: 5 },
				3: { 2: 2, 3: 9 },
			}),
			DEFAULT_SITE,
		);

		// Sites 2 and 3 both qualify; 3 holds more of the order (5+5+9 against 5+5+2)
		expect(summarize(groups)).toEqual([
			{ warehouse_id: 3, lines: { 1: 1, 2: 1, 3: 1 } },
		]);
	});

	it('keeps what the default holds there and sends the rest from the site holding the most', () => {
		// A and B at the default; C only at sites 2 (5) and 3 (10)
		const groups = planDeliveries(
			[line(1), line(2), line(3, 2)],
			stock({
				1: { 1: 4 },
				2: { 1: 4 },
				3: { 2: 5, 3: 10 },
			}),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 1, lines: { 1: 1, 2: 1 } },
			{ warehouse_id: 3, lines: { 3: 2 } },
		]);
	});

	it('finds the smallest set where a greedy pick would take one parcel more', () => {
		/*
		 * Site 4 holds the most lines (1-4), and taking it first leaves 5 and 6 on two more sites -
		 * three parcels. Sites 2 and 3 cover everything between them in two.
		 */
		const groups = planDeliveries(
			[line(1), line(2), line(3), line(4), line(5), line(6)],
			stock({
				1: { 2: 1, 4: 1 },
				2: { 2: 1, 4: 1 },
				3: { 3: 1, 4: 1 },
				4: { 3: 1, 4: 1 },
				5: { 2: 1 },
				6: { 3: 1 },
			}),
			DEFAULT_SITE,
		);

		expect(groups.map((group) => group.warehouse_id).sort()).toEqual([
			2, 3,
		]);
	});

	it('divides a variant across sites only when no site can send it whole', () => {
		const groups = planDeliveries(
			[line(1, 10)],
			stock({ 1: { 1: 3, 2: 8 } }),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 1, lines: { 1: 2 } },
			{ warehouse_id: 2, lines: { 1: 8 } },
		]);
	});

	it('prefers whole lines over a split at the same parcel count', () => {
		// {1, 2} could send variant 1 only as 1 + 3; {1, 3} sends each line whole
		const groups = planDeliveries(
			[line(1, 4), line(2)],
			stock({
				1: { 1: 1, 2: 3, 3: 4 },
				2: { 1: 1 },
			}),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 1, lines: { 2: 1 } },
			{ warehouse_id: 3, lines: { 1: 4 } },
		]);
	});

	it('puts a backordered shortfall on the delivery already carrying the variant', () => {
		const groups = planDeliveries(
			[line(1), line(2, 5)],
			stock({ 1: { 1: 1 }, 2: { 2: 3 } }),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 1, lines: { 1: 1 } },
			{ warehouse_id: 2, lines: { 2: 5 } },
		]);
	});

	it('sends untracked and out-of-stock lines with the first delivery', () => {
		const groups = planDeliveries(
			[line(1), line(2), line(3)],
			stock({ 1: { 2: 1 }, 3: {} }),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 2, lines: { 1: 1, 2: 1, 3: 1 } },
		]);
	});

	it('falls back to one delivery from the default when nothing is tracked', () => {
		const lines = [line(1), line(2)];

		expect(planDeliveries(lines, new Map(), DEFAULT_SITE)).toEqual([
			{ warehouse_id: DEFAULT_SITE, lines: lines },
		]);
	});

	it('breaks ties on the lower site id', () => {
		const groups = planDeliveries(
			[line(1)],
			stock({ 1: { 3: 5, 2: 5 } }),
			DEFAULT_SITE,
		);

		expect(summarize(groups)).toEqual([
			{ warehouse_id: 2, lines: { 1: 1 } },
		]);
	});

	it('puts the default first, or else the delivery with the most lines', () => {
		const withDefault = planDeliveries(
			[line(1), line(2), line(3)],
			stock({ 1: { 2: 1 }, 2: { 2: 1 }, 3: { 1: 1 } }),
			DEFAULT_SITE,
		);

		expect(withDefault.map((group) => group.warehouse_id)).toEqual([1, 2]);

		const withoutDefault = planDeliveries(
			[line(1), line(2), line(3)],
			stock({ 1: { 2: 1 }, 2: { 3: 1 }, 3: { 3: 1 } }),
			DEFAULT_SITE,
		);

		expect(withoutDefault.map((group) => group.warehouse_id)).toEqual([
			3, 2,
		]);
	});
});
