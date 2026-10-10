import ClientLedgerEntity from '@/features/client-ledger/client-ledger.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

/**
 * Read-only: the ledger is written by the settlement chain and by nothing a person sends, so
 * only `read` (the balance) and `find` (the entries) are ever checked.
 */
export class ClientLedgerPolicy extends PolicyAbstract {
	constructor() {
		super(ClientLedgerEntity.NAME);
	}
}

export const clientLedgerPolicy = new ClientLedgerPolicy();
