import type { EntityManager } from 'typeorm';
import type { ShippingScope } from '@/features/shipping/shipping.entity';
import { createNotification, createQuery } from '@/helpers/hook.helper';

/**
 * What `shipping` announces about its own rows, and what it asks while moving one along.
 *
 * - **After the commit** - `notifyShippingChanged`, answered by whichever feature bills orders
 *   (`invoice`). See `invoice.hooks.ts` for the invoice-first chain this step belongs to.
 * - **Inside the status transaction** - `moveShippedStock` and `restoreReturnedStock`, answered by
 *   `warehouse-movement`: the goods leave stock in the same transaction that says they left, and
 *   a shortage refuses the move rather than leaving a shipped parcel nothing was drawn for.
 *
 * Both answering features depend on `shipping` and register from their bootstrap. With either
 * absent its slot is empty: movements are billed with no stock kept, or kept with nothing billed.
 */

/**
 * A movement of goods has just been written or moved along. `order_id` is null on a `relocation`,
 * which bills nobody and is announced only so the payload never has to be filtered by the sender.
 */
export type ShippingChangedPayload = {
	shipping_id: number;
	order_id: number | null;
};

const shippingChanged = createNotification<ShippingChangedPayload>(
	'Failed to bill or settle the order behind a shipping change',
);

export const registerShippingChangedHandler = shippingChanged.register;
export const notifyShippingChanged = shippingChanged.notify;

/** The movement whose goods are leaving or coming back - its lines are read by id. */
export type ShippingStockMove = {
	shipping_id: number;
	order_id: number | null;
	scope: ShippingScope;
	pickup_warehouse_id: number | null;
};

const shippedStockMover = createQuery<
	[manager: EntityManager, move: ShippingStockMove],
	void
>(() => undefined);

const returnedStockRestorer = createQuery<
	[manager: EntityManager, move: ShippingStockMove],
	void
>(() => undefined);

export const registerShippedStockMover = shippedStockMover.register;

/** Takes a movement's goods out of stock as it ships; nothing without `warehouse-movement`. */
export const moveShippedStock = shippedStockMover.ask;

export const registerReturnedStockRestorer = returnedStockRestorer.register;

/**
 * Puts a shipped movement's goods back as it comes back undelivered (`shipped` -> `returned`);
 * nothing without `warehouse-movement`.
 */
export const restoreReturnedStock = returnedStockRestorer.ask;
