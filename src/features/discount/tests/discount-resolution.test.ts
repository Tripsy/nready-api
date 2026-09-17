import DiscountEntity, {
	type DiscountConditions,
	DiscountReasonEnum,
	type DiscountScope,
	DiscountScopeEnum,
	type DiscountType,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';
import {
	computeOrderReductions,
	computeReduction,
	computeShippingReduction,
	type DiscountLineContext,
	evaluateConditions,
	type OrderDiscountBasis,
} from '@/features/discount/discount-resolution.service';

function makeDiscount(overrides: {
	id?: number;
	type?: DiscountType;
	value: number;
	scope?: DiscountScope;
	conditions?: DiscountConditions;
}): DiscountEntity {
	const discount = new DiscountEntity();

	discount.id = overrides.id ?? 1;
	discount.label = 'Test';
	discount.scope = overrides.scope ?? DiscountScopeEnum.PRODUCT;
	discount.reason = DiscountReasonEnum.SPECIAL_DISCOUNT;
	discount.reference = 'TEST';
	discount.type = overrides.type ?? DiscountTypeEnum.PERCENT;
	discount.value = overrides.value;
	discount.conditions = overrides.conditions;

	return discount;
}

const baseContext: DiscountLineContext = {
	variantId: 1,
	productId: 1,
	quantity: 1,
	unitPrice: 100,
	exchangeRate: 1,
};

describe('computeOrderReductions', () => {
	const basis = (
		...lines: (number | OrderDiscountBasis)[]
	): OrderDiscountBasis[] =>
		lines.map((line) => (typeof line === 'number' ? { net: line } : line));

	const orderDiscount = (value: number, type?: DiscountType) =>
		makeDiscount({ value, type, scope: DiscountScopeEnum.ORDER });

	it('apportions a percentage pro-rata by what each line still costs', () => {
		expect(
			computeOrderReductions(orderDiscount(10), basis(60, 40), 1),
		).toEqual([6, 4]);
	});

	it('converts an absolute campaign from base into the sale currency', () => {
		expect(
			computeOrderReductions(
				orderDiscount(20, DiscountTypeEnum.AMOUNT),
				basis(60, 40),
				2,
			),
		).toEqual([6, 4]);
	});

	it('clamps a line to its headroom and does not pass the remainder on', () => {
		// The 10% campaign is worth 10, but the first line may only give up 2 more before it
		// reaches its floor. The second keeps its own share rather than absorbing the rest.
		expect(
			computeOrderReductions(
				orderDiscount(10),
				basis({ net: 60, headroom: 2 }, { net: 40 }),
				1,
			),
		).toEqual([2, 4]);
	});

	it('never takes more off than the basket still costs', () => {
		expect(
			computeOrderReductions(
				orderDiscount(100, DiscountTypeEnum.AMOUNT),
				basis(10, 10),
				1,
			),
		).toEqual([10, 10]);
	});

	it('reconciles the rounding remainder so the shares sum to the campaign', () => {
		const reductions = computeOrderReductions(
			orderDiscount(10),
			basis(33.33, 33.33, 33.34),
			1,
		);

		expect(reductions.reduce((sum, value) => sum + value, 0)).toBe(10);
	});

	it('takes nothing off a basket with no money left on it', () => {
		expect(
			computeOrderReductions(orderDiscount(10), basis(0, 0), 1),
		).toEqual([0, 0]);
	});
});

describe('computeReduction', () => {
	it('applies a percentage to the unit price, times quantity', () => {
		const reduction = computeReduction(makeDiscount({ value: 10 }), {
			...baseContext,
			quantity: 3,
		});

		expect(reduction).toBe(30);
	});

	it('treats an absolute discount as per unit, matching percent', () => {
		const reduction = computeReduction(
			makeDiscount({ type: DiscountTypeEnum.AMOUNT, value: 10 }),
			{ ...baseContext, quantity: 3 },
		);

		expect(reduction).toBe(30);
	});

	it('converts an absolute discount from base into the sale currency', () => {
		// base = sale x rate, so a rate of 5 means 20 base is 4 in the sale currency
		const reduction = computeReduction(
			makeDiscount({ type: DiscountTypeEnum.AMOUNT, value: 20 }),
			{ ...baseContext, exchangeRate: 5 },
		);

		expect(reduction).toBe(4);
	});

	it('clamps at min_price when one is set', () => {
		// 50% of 100 would be 50, but the floor of 80 only allows 20 off
		const reduction = computeReduction(makeDiscount({ value: 50 }), {
			...baseContext,
			minPrice: 80,
		});

		expect(reduction).toBe(20);
	});

	it('takes the line to zero when min_price is absent, whatever the goods cost', () => {
		// Cost is an accounting figure and never floors a sale: without a min_price the only
		// guard left is zero.
		const reduction = computeReduction(makeDiscount({ value: 90 }), {
			...baseContext,
			exchangeRate: 2,
		});

		expect(reduction).toBe(90);
	});

	it('honors a min_price that sits below cost', () => {
		// a campaign may deliberately price under cost; min_price is the commercial decision
		const reduction = computeReduction(makeDiscount({ value: 100 }), {
			...baseContext,
			minPrice: 10,
		});

		expect(reduction).toBe(90);
	});

	it('never takes a line below zero when no floor is set', () => {
		const reduction = computeReduction(
			makeDiscount({ type: DiscountTypeEnum.AMOUNT, value: 500 }),
			baseContext,
		);

		expect(reduction).toBe(100);
	});

	it('rounds to two decimals', () => {
		const reduction = computeReduction(makeDiscount({ value: 33.33 }), {
			...baseContext,
			unitPrice: 10,
			quantity: 3,
		});

		expect(reduction).toBe(10);
	});
});

describe('evaluateConditions', () => {
	it('passes when there are no rules', () => {
		expect(evaluateConditions(undefined, baseContext)).toBe(true);
	});

	it('compares min_order_value in the base currency', () => {
		const rules = { min_order_value: 200 };

		// 120 sale at rate 2 is 240 base, which clears the 200 threshold
		expect(
			evaluateConditions(rules, {
				...baseContext,
				orderValue: 120,
				exchangeRate: 2,
			}),
		).toBe(true);

		expect(
			evaluateConditions(rules, {
				...baseContext,
				orderValue: 120,
				exchangeRate: 1,
			}),
		).toBe(false);
	});

	it('honors hour_range against the supplied clock', () => {
		const at = (hour: number) => new Date(2026, 7, 13, hour, 30);

		expect(
			evaluateConditions(
				{ hour_range: [10, 18] },
				{ ...baseContext, now: at(12) },
			),
		).toBe(true);

		expect(
			evaluateConditions(
				{ hour_range: [10, 18] },
				{ ...baseContext, now: at(9) },
			),
		).toBe(false);

		// inclusive at both ends
		expect(
			evaluateConditions(
				{ hour_range: [10, 18] },
				{ ...baseContext, now: at(18) },
			),
		).toBe(true);
	});

	it('accepts an hour_range that wraps past midnight', () => {
		const at = (hour: number) => new Date(2026, 7, 13, hour, 30);

		// a 22:00-04:00 happy hour is a range, not an empty set
		expect(
			evaluateConditions(
				{ hour_range: [22, 4] },
				{ ...baseContext, now: at(23) },
			),
		).toBe(true);

		expect(
			evaluateConditions(
				{ hour_range: [22, 4] },
				{ ...baseContext, now: at(2) },
			),
		).toBe(true);

		expect(
			evaluateConditions(
				{ hour_range: [22, 4] },
				{ ...baseContext, now: at(12) },
			),
		).toBe(false);
	});

	it('reads day_range as ISO weekdays, not the Sunday-based getDay', () => {
		// 2026-08-13 is a Thursday (ISO 4); 2026-08-16 is a Sunday (ISO 7)
		const thursday = new Date(2026, 7, 13, 12);
		const sunday = new Date(2026, 7, 16, 12);

		expect(
			evaluateConditions(
				{ day_range: [1, 5] },
				{ ...baseContext, now: thursday },
			),
		).toBe(true);

		expect(
			evaluateConditions(
				{ day_range: [1, 5] },
				{ ...baseContext, now: sunday },
			),
		).toBe(false);

		// Sunday must be reachable at all - it is 7, and a naive getDay() would call it 0
		expect(
			evaluateConditions(
				{ day_range: [6, 7] },
				{ ...baseContext, now: sunday },
			),
		).toBe(true);
	});

	// Alpha-2 throughout, the vocabulary every country rule shares - the evaluator only uppercases
	// and compares, so it would pass either way, but a fixture in a vocabulary the validator
	// refuses to store is a test documenting a contract that does not exist
	it('matches applicable_countries case-insensitively and fails a missing country', () => {
		const rules = { applicable_countries: ['RO', 'BG'] };

		expect(
			evaluateConditions(rules, { ...baseContext, countryCode: 'ro' }),
		).toBe(true);

		expect(
			evaluateConditions(rules, { ...baseContext, countryCode: 'HU' }),
		).toBe(false);

		expect(evaluateConditions(rules, baseContext)).toBe(false);
	});

	it('fails closed on an unknown condition key', () => {
		// a typo must not silently drop the guard it was meant to express
		expect(
			evaluateConditions(
				{ min_order_vaule: 10_000 } as unknown as DiscountConditions,
				{ ...baseContext, orderValue: 1 },
			),
		).toBe(false);
	});
});

describe('computeShippingReduction', () => {
	const shippingDiscount = (value: number, type?: DiscountType) =>
		makeDiscount({ value, type, scope: DiscountScopeEnum.SHIPPING });

	it('applies a percentage to the shipment price', () => {
		expect(computeShippingReduction(shippingDiscount(50), 20.66, 1)).toBe(
			10.33,
		);
	});

	it('converts an absolute discount from base into the sale currency', () => {
		expect(
			computeShippingReduction(
				shippingDiscount(10, DiscountTypeEnum.AMOUNT),
				20,
				5,
			),
		).toBe(2);
	});

	it('never takes more off than the price - free is the limit', () => {
		expect(
			computeShippingReduction(
				shippingDiscount(100, DiscountTypeEnum.AMOUNT),
				20.66,
				1,
			),
		).toBe(20.66);
		expect(computeShippingReduction(shippingDiscount(100), 20.66, 1)).toBe(
			20.66,
		);
	});
});
