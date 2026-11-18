import { createQuery } from '@/helpers/hook.helper';

/**
 * What `cart` asks while pricing a basket.
 *
 * `resolveStockAvailability` is answered by `warehouse-movement`, which depends on `cart` and
 * registers from its bootstrap. With it absent - or in the `test` environment - the answer is
 * empty: every line reads as untracked, nothing is flagged short, and checkout sells as it would
 * with no stock kept.
 */

/** What can still be sold of one stock-tracked variant. */
export type VariantAvailability = {
	/** On hand in active warehouses less what live orders reserve; negative when over-committed. */
	available: number;
	allow_backorder: boolean;
	low_stock_threshold: number | null;
};

/*
 * A query rather than a notification: the basket waits for the answer. A failure propagates - a
 * cart priced as if the stock were there would promise what checkout then refuses.
 */
const stockAvailability = createQuery<
	[variantIds: readonly number[]],
	Map<number, VariantAvailability>
>(() => new Map());

export const registerStockAvailabilityResolver = stockAvailability.register;

/**
 * Availability per variant, for the stock-tracked ones among `variantIds` only - an untracked
 * variant is absent from the map, which is how the cart tells "never short" from "none left".
 */
export const resolveStockAvailability = stockAvailability.ask;
