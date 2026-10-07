import type { EntityManager } from 'typeorm';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import { createNotification, createQuery } from '@/helpers/hook.helper';

/**
 * What `cash-flow` announces when a movement completes, at the two moments it can be heard.
 *
 * - **Inside the completing transaction** - `recordLedgerMovement`, answered by `client-ledger`.
 *   The recorder is handed the caller's `EntityManager` and awaited, so a movement is never
 *   completed without its ledger entry, and a throw takes the completion back with it.
 * - **After the commit** - `notifyCashFlowCompleted`, answered by `invoice`, which spreads the
 *   money over the client's open documents. See `invoice.hooks.ts` for that chain.
 *
 * Both answering features depend on `cash-flow` and register from their bootstrap. With either
 * absent its slot is empty: money is captured, refunded and allocated the same, with no ledger kept
 * or no document settled.
 */

/**
 * A movement has just been captured.
 *
 * Announced for every movement filed under a client, not only for one raised for an order: money
 * is allocated against the client's documents oldest first, so a deposit settles an open invoice
 * the same way a checkout payment does.
 */
export type CashFlowCompletedPayload = {
	cash_flow_id: number;
};

/** What the ledger reads of a movement; only a completed one, filed under a client, is booked. */
export type LedgerMovement = Pick<
	CashFlowEntity,
	| 'id'
	| 'parent_id'
	| 'status'
	| 'direction'
	| 'amount'
	| 'vat_rate'
	| 'currency'
	| 'exchange_rate'
	| 'updated_at'
>;

const cashFlowCompleted = createNotification<CashFlowCompletedPayload>(
	'Failed to record and allocate a captured payment',
);

const ledgerRecorder = createQuery<
	[manager: EntityManager, movement: LedgerMovement],
	void
>(() => undefined);

export const registerCashFlowCompletedHandler = cashFlowCompleted.register;
export const notifyCashFlowCompleted = cashFlowCompleted.notify;

export const registerClientLedgerRecorder = ledgerRecorder.register;

/** Books a completed movement on its client's ledger; nothing without the ledger feature. */
export const recordLedgerMovement = ledgerRecorder.ask;
