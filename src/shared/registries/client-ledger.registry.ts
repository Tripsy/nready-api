import type { EntityManager } from 'typeorm';

/**
 * The client ledger, reached without importing the feature that keeps it.
 *
 * The ledger is the money that moved with a client: one entry per completed cash flow filed under
 * them. `client-ledger` depends on `cash-flow` - its rows name the movement - so `cash-flow` cannot
 * import it back, yet `cash-flow` is where a movement is completed. It tells this registry, and the
 * ledger registers the recorder from `client-ledger.bootstrap.ts`.
 *
 * **Optional.** With the ledger feature absent nothing is registered and the call does nothing:
 * money is captured, refunded and allocated the same, and no ledger is kept.
 *
 * **Inside the caller's transaction, unlike `order-settlement.registry.ts`.** The recorder is
 * handed the caller's `EntityManager` and awaited, so a movement is never completed without its
 * entry, and a throw takes the completion back with it.
 *
 * The shape below is what the recorder reads, declared here rather than imported - the import is
 * the dependency this file exists to remove. A cash flow entity satisfies it structurally.
 */

/** A cash movement; only a completed one, filed under a client, is booked. */
export type LedgerMovement = {
	id: number;
	parent_id: number | null;
	status: string;
	direction: string;
	amount: number;
	vat_rate: number;
	currency: string;
	exchange_rate: number;
	updated_at: Date | null;
};

export type ClientLedgerRecorder = (
	manager: EntityManager,
	movement: LedgerMovement,
) => Promise<void>;

let recorder: ClientLedgerRecorder | null = null;

/** One recorder - the ledger is one table. `null` unregisters it, which is what a test resets to. */
export function registerClientLedgerRecorder(
	value: ClientLedgerRecorder | null,
): void {
	recorder = value;
}

/** Books a completed movement on its client's ledger; nothing without the ledger feature. */
export async function recordLedgerMovement(
	manager: EntityManager,
	movement: LedgerMovement,
): Promise<void> {
	await recorder?.(manager, movement);
}
