import type { EntityManager } from 'typeorm';
import type { ShippingScope } from '@/features/shipping/shipping.entity';
import { createNotification, createQuery } from '@/helpers/hook.helper';

/**
 * What `shipping` announces about its own rows, and what it asks while moving one along.
 *
 * - **After the commit** - `notifyShippingChanged`, answered by whichever feature bills orders
 *   (`invoice`). See `invoice.hooks.ts` for the invoice-first chain this step belongs to.
 * - **After the commit** - `notifyReturnReceived`, answered by `order-return`: a `return` movement
 *   reached its warehouse, so the return document it carries can move on and its refund be drafted.
 * - **Inside the status transaction** - `moveShippedStock`, `restoreReturnedStock`,
 *   `writeOffLostStock` and `receiveReturnedStock`, answered by `warehouse-movement`: the goods
 *   leave, re-enter or are written off in the same transaction that says they moved, and a
 *   shortage refuses the move rather than leaving a shipped parcel nothing was drawn for.
 *
 * Every answering feature depends on `shipping` and registers from its bootstrap. With one absent
 * its slot is empty: movements are billed with no stock kept, kept with nothing billed, or received
 * back with no return document to close.
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
	destination_warehouse_id: number | null;
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

const lostStockWriter = createQuery<
	[manager: EntityManager, move: ShippingStockMove],
	void
>(() => undefined);

export const registerLostStockWriter = lostStockWriter.register;

/**
 * Books a shipped movement's goods as lost as it fails in transit (`shipped` -> `failed`) - they
 * stay off the shelf, but are no longer counted as sold; nothing without `warehouse-movement`.
 */
export const writeOffLostStock = lostStockWriter.ask;

const returnedStockReceiver = createQuery<
	[manager: EntityManager, move: ShippingStockMove],
	void
>(() => undefined);

export const registerReturnedStockReceiver = returnedStockReceiver.register;

/**
 * Takes a client's `return` into stock as it reaches the warehouse (`shipped` -> `delivered`), by
 * each line's `condition`; nothing without `warehouse-movement`.
 */
export const receiveReturnedStock = returnedStockReceiver.ask;

/** A `return` movement reached its warehouse. Always tied to an order - the scope requires one. */
export type ReturnReceivedPayload = {
	shipping_id: number;
	order_id: number;
};

const returnReceived = createNotification<ReturnReceivedPayload>(
	'Failed to move the return document behind a received return',
);

export const registerReturnReceivedHandler = returnReceived.register;
export const notifyReturnReceived = returnReceived.notify;
