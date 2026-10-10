import { registerClientLedgerRecorder } from '@/features/cash-flow/cash-flow.hooks';
import { clientLedgerService } from '@/features/client-ledger/client-ledger.service';

/**
 * Keeps the money moved with each client: registers the recorder `cash-flow` books a completed
 * movement through, so `cash-flow` never imports this feature - it depends the other way round.
 *
 * Without this feature nothing is registered, and money is captured, refunded and allocated the
 * same with no ledger kept. See `cash-flow.hooks.ts` for why the recorder runs inside the
 * caller's transaction.
 */
export default function registerClientLedgerBootstrap() {
	registerClientLedgerRecorder((manager, movement) =>
		clientLedgerService.recordCashFlow(movement, manager),
	);
}
