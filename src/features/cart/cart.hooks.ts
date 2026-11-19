import type { EntityManager } from 'typeorm';
import { createQuery } from '@/helpers/hook.helper';

/**
 * What `cart` asks while pricing a basket and while turning one into an order.
 *
 * Both are answered by `warehouse-movement`, which depends on `cart` and registers from its
 * bootstrap. With it absent - or in the `test` environment - each answer is empty:
 *
 * - `resolveStockAvailability` - every line reads as untracked, nothing is flagged short, and
 *   checkout sells as it would with no stock kept.
 * - `resolveWarehouseAvailability` - no site is known to hold anything, so checkout writes a single
 *   delivery from the default warehouse.
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

/**
 * What each active warehouse can still send of a stock-tracked variant: `variant_id` ->
 * `warehouse_id` -> quantity. A site holding none of a variant is absent from its inner map, and an
 * untracked variant is absent from the outer one. Figures can be negative when a site is
 * over-committed.
 */
export type WarehouseAvailability = Map<number, Map<number, number>>;

/*
 * Asked inside the checkout transaction, after the order has reserved its stock, so the read sits
 * behind the variant locks the reservation took and two checkouts racing for one site's last units
 * plan one after the other. A failure propagates and refuses the checkout - a plan built on a
 * guess would send a parcel from a site that cannot fill it.
 */
const warehouseAvailability = createQuery<
	[manager: EntityManager, variantIds: readonly number[]],
	WarehouseAvailability
>(() => new Map());

export const registerWarehouseAvailabilityResolver =
	warehouseAvailability.register;

/**
 * Per-warehouse availability for the stock-tracked ones among `variantIds`, read through the
 * caller's manager. Used by checkout to decide which warehouse each delivery leaves from.
 */
export const resolveWarehouseAvailability = warehouseAvailability.ask;
