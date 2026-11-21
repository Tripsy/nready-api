import type { EntityManager } from 'typeorm';
import { createQuery } from '@/helpers/hook.helper';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * What `cart` asks while turning a basket into an order.
 *
 * Answered by `warehouse-movement`, which depends on `cart` and registers from its bootstrap. With
 * it absent - or in the `test` environment - no site is known to hold anything, so checkout writes
 * a single delivery from the default warehouse.
 *
 * The availability the basket is priced against is not here: `product` asks the same question for
 * the storefront, so it lives in `shared/registries/stock-availability.registry.ts`.
 */

/**
 * What each active warehouse can still send of a stock-tracked variant: `variant_id` ->
 * `warehouse_id` -> quantity. A site holding none of a variant is absent from its inner map, and an
 * untracked variant is absent from the outer one. Figures can be negative when a site is
 * over-committed.
 */
export type WarehouseAvailability = Map<EntityId, Map<EntityId, number>>;

/*
 * Asked inside the checkout transaction, after the order has reserved its stock, so the read sits
 * behind the variant locks the reservation took and two checkouts racing for one site's last units
 * plan one after the other. A failure propagates and refuses the checkout - a plan built on a
 * guess would send a parcel from a site that cannot fill it.
 */
const warehouseAvailability = createQuery<
	[manager: EntityManager, variantIds: readonly EntityId[]],
	WarehouseAvailability
>(() => new Map());

export const registerWarehouseAvailabilityResolver =
	warehouseAvailability.register;

/**
 * Per-warehouse availability for the stock-tracked ones among `variantIds`, read through the
 * caller's manager. Used by checkout to decide which warehouse each delivery leaves from.
 */
export const resolveWarehouseAvailability = warehouseAvailability.ask;
