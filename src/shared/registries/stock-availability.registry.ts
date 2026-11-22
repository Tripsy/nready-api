import { createQuery } from '@/helpers/hook.helper';

/**
 * What can still be sold of a stock-tracked variant, asked without importing the feature that
 * keeps stock.
 *
 * A registry rather than a `<feature>.hooks.ts` because two features ask it and neither owns the
 * question: `cart` while pricing a basket, `product` while telling a visitor whether a variant is
 * in stock. `warehouse-movement` answers, registering from its bootstrap. With it absent - or in the
 * `test` environment - the answer is an empty map: every variant reads as untracked, the basket
 * flags nothing short and the storefront states no stock.
 */

/** What can still be sold of one stock-tracked variant. */
export type VariantAvailability = {
	/** On hand in active warehouses less what live orders reserve; negative when over-committed. */
	available: number;
	allow_backorder: boolean;
	low_stock_threshold: number | null;
};

/*
 * A query rather than a notification: the caller waits for the answer. A failure propagates - a
 * cart priced as if the stock were there would promise what checkout then refuses.
 */
const stockAvailability = createQuery<
	[variantIds: readonly number[]],
	Map<number, VariantAvailability>
>(() => new Map());

/** Called from the stock-keeping feature's `*.bootstrap.ts`. */
export const registerStockAvailabilityResolver = stockAvailability.register;

/**
 * Availability per variant, for the stock-tracked ones among `variantIds` only - an untracked
 * variant is absent from the map, which is how a caller tells "never short" from "none left".
 */
export const resolveStockAvailability = (
	variantIds: readonly number[],
): Promise<Map<number, VariantAvailability>> => {
	if (variantIds.length === 0) {
		return Promise.resolve(new Map());
	}

	return stockAvailability.ask(variantIds);
};
