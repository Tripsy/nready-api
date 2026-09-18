import {
	isDirectRun,
	type Random,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import CashFlowEntity, {
	AMOUNT_DECIMALS,
	CashFlowMethodEnum,
	CashFlowStatusEnum,
	getExpectedCategoryType,
	getExpectedDirection,
} from '@/features/cash-flow/cash-flow.entity';
import {
	type CashFlowCategory,
	CashFlowCategoryEnum,
} from '@/features/cash-flow/cash-flow-category.enum';
import { resolveBaseCurrency } from '@/features/exchange-rate/exchange-rate.entity';

const TARGET = 150;

/** How many months back the rows are spread, counting the current one. */
const MONTH_SPREAD = 6;

/**
 * Only the categories `getExpectedCategoryType` actually classifies - the enum carries
 * fleet-specific values (`fuel`, `tolls`, the `employee_*` family) that this project does
 * not map, and passing one in would throw `Unknown category`.
 *
 * `refund` is classified but still absent: the table's CHECK constraint only allows
 * `category_type = 'correction'` on a row that has a `parent_id`, and this seed creates no
 * parent/child pairs.
 */
const CATEGORY_POOL: readonly CashFlowCategory[] = [
	CashFlowCategoryEnum.CUSTOMER,
	CashFlowCategoryEnum.CUSTOMER,
	CashFlowCategoryEnum.CUSTOMER,
	CashFlowCategoryEnum.CUSTOMER,
	CashFlowCategoryEnum.VENDOR,
	CashFlowCategoryEnum.VENDOR,
	CashFlowCategoryEnum.INSURANCE,
	CashFlowCategoryEnum.TAXES,
];

/** Plausible value band per seeded category, in whole currency units. */
const AMOUNT_RANGES: Partial<
	Record<CashFlowCategory, readonly [number, number]>
> = {
	[CashFlowCategoryEnum.CUSTOMER]: [80, 4500],
	[CashFlowCategoryEnum.VENDOR]: [100, 3000],
	[CashFlowCategoryEnum.INSURANCE]: [400, 3500],
	[CashFlowCategoryEnum.TAXES]: [300, 6000],
};

const VAT_RATES = [0, 5, 9, 19, 21] as const;

/**
 * Rate against the base currency; only a foreign-currency row carries anything but 1. Keyed by
 * ISO code, so a deployment based on a currency not listed here seeds every row at 1.
 */
const EXCHANGE_RATES: Record<string, number> = {
	RON: 1,
	EUR: 5.08,
	USD: 4.66,
};

/**
 * A moment inside the month `index` falls into, spreading the rows evenly over the last
 * `MONTH_SPREAD` months. Without this every row carries the instant the seed ran, so any
 * month-over-month figure - the dashboard's revenue and expense trend - divides by an empty
 * previous month and can only ever report a no-baseline +/-100%.
 *
 * The current month stops at today: a cash flow dated in the future is not something the app
 * should ever be asked to render.
 */
function createdAtForIndex(random: Random, index: number): Date {
	const now = new Date();
	const monthsAgo = index % MONTH_SPREAD;

	const year = now.getFullYear();
	const month = now.getMonth() - monthsAgo;

	// Day 0 of the following month is the last day of this one, which keeps a 31 from rolling
	// over into the next month when the target month is shorter.
	const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
	const maxDay = monthsAgo === 0 ? now.getDate() : lastDayOfMonth;

	return new Date(
		year,
		month,
		randomInt(random, 1, maxDay),
		randomInt(random, 8, 19),
		randomInt(random, 0, 59),
		randomInt(random, 0, 59),
	);
}

export const cashFlowSeed: SeedDefinition = {
	name: 'cash-flow',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const baseCurrency = resolveBaseCurrency();

		return topUp({
			entity: 'cash-flow',
			target: TARGET,
			manager,
			entityClass: CashFlowEntity,
			// Nullable and indexed, and every seeded row fills it - so it identifies the
			// demo rows without touching anything already in the table.
			keyColumn: 'external_reference',
			buildRow: (index) => {
				const category = randomPick(random, CATEGORY_POOL);
				const categoryType = getExpectedCategoryType(category);
				const direction = getExpectedDirection(categoryType);

				if (!direction) {
					throw new Error(
						`Category "${category}" has no fixed direction and needs a parent entry`,
					);
				}

				const range = AMOUNT_RANGES[category];

				if (!range) {
					throw new Error(
						`Category "${category}" has no amount range`,
					);
				}

				const [minAmount, maxAmount] = range;

				const currency = randomPick(random, [
					baseCurrency,
					baseCurrency,
					baseCurrency,
					'EUR',
				]);

				return {
					direction,
					category_type: categoryType,
					category,
					method: randomPick(random, [
						CashFlowMethodEnum.CREDIT_CARD,
						CashFlowMethodEnum.CREDIT_CARD,
						CashFlowMethodEnum.DEBIT_CARD,
						CashFlowMethodEnum.PAYPAL,
						CashFlowMethodEnum.BANK_TRANSFER,
						CashFlowMethodEnum.CASH,
					]),
					status: randomPick(random, [
						CashFlowStatusEnum.COMPLETED,
						CashFlowStatusEnum.COMPLETED,
						CashFlowStatusEnum.COMPLETED,
						CashFlowStatusEnum.PENDING,
						CashFlowStatusEnum.AUTHORIZED,
						CashFlowStatusEnum.CANCELED,
					]),
					// Stored separator-less, scaled by 10 ** AMOUNT_DECIMALS, and the CHECK
					// constraint requires it to be strictly positive.
					amount:
						randomInt(random, minAmount, maxAmount) *
						10 ** AMOUNT_DECIMALS,
					vat_rate: randomPick(random, VAT_RATES),
					currency,
					exchange_rate:
						currency === baseCurrency
							? 1
							: (EXCHANGE_RATES[currency] ?? 1),
					external_reference: `SEED-CF-${sequenceLabel(index, 5)}`,
					parent_id: null,
					notes: null,
					// `@CreateDateColumn` only falls back to the column default when the value
					// is undefined, so an explicit date is kept as-is.
					created_at: createdAtForIndex(random, index),
				};
			},
		});
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(cashFlowSeed);
}
