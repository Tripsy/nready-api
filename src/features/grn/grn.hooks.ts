import type { EntityManager } from 'typeorm';
import { createQuery } from '@/helpers/hook.helper';

/**
 * What `grn` asks of the stock ledger while it confirms or cancels a receipt, all inside the
 * caller's transaction.
 *
 * Answered by `warehouse-movement`, which depends on `grn` (every movement names the lot it
 * touched) and registers from its bootstrap - so `grn` never imports the ledger. With the ledger
 * absent every slot is empty: receipts still open and close their lots and re-average the cost,
 * with no audit trail kept, and the "lot moved" guard falls back to the `qty_remaining` check
 * `cancelWithin` runs first.
 *
 * Queries rather than notifications: each is handed the manager and awaited, so a receipt is never
 * confirmed without its movements, and a throw in the ledger takes the confirmation back with it.
 */

/** One confirmed line, as the ledger books it. */
export type StockReceipt = {
	grn_item_id: number;
	warehouse_id: number;
	variant_id: number;
	qty: number;
	unit_cost_base: number;
	occurred_at: Date; // The receiving day - it orders the FIFO pick
};

/** The first movement found against a lot other than its own receipt. */
export type LotMovement = {
	grn_item_id: number | null;
	variant_id: number;
	movement_type: string;
};

const receiptRecorder = createQuery<
	[manager: EntityManager, receipts: StockReceipt[]],
	void
>(() => undefined);

const lotMovementFinder = createQuery<
	[manager: EntityManager, grnItemIds: number[]],
	LotMovement | null
>(() => null);

const receiptReverser = createQuery<
	[manager: EntityManager, grnItemIds: number[], occurredAt: Date],
	void
>(() => undefined);

export const registerReceiptRecorder = receiptRecorder.register;

/** Posts a `receipt` movement per confirmed line; nothing without the ledger. */
export const recordReceipts = receiptRecorder.ask;

export const registerLotMovementFinder = lotMovementFinder.register;

/**
 * Whether any of the lots has moved beyond its own receipt. `qty_remaining` is net - a sale
 * answered by a return brings it back to `qty` - so only the ledger can tell. Null without it.
 */
export const findLotMovement = lotMovementFinder.ask;

export const registerReceiptReverser = receiptReverser.register;

/** Answers each lot's `receipt` movement with a reversing row; nothing without the ledger. */
export const reverseReceipts = receiptReverser.ask;
