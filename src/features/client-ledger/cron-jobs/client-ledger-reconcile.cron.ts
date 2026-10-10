import { clientLedgerService } from '@/features/client-ledger/client-ledger.service';

export const SCHEDULE_EXPRESSION = '45 01 * * *';
export const EXPECTED_RUN_TIME = 10; // seconds

/**
 * Books every completed client movement the ledger does not hold yet.
 *
 * A movement is booked in the transaction that completes it, so one is missing only when it was
 * completed while this feature was not installed, or written to the table directly - a seed, an
 * import. This is what catches those up.
 *
 * Daily, at night. Batched and idempotent: a backlog clears over consecutive runs.
 */
const clientLedgerReconcile = async () => {
	return clientLedgerService.reconcile();
};

export default clientLedgerReconcile;
