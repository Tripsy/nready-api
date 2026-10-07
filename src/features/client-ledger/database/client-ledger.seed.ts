import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ClientLedgerEntity from '@/features/client-ledger/client-ledger.entity';
import { clientLedgerService } from '@/features/client-ledger/client-ledger.service';

/**
 * Demo client ledger: the entries the seeded cash flows imply.
 *
 * Not generated - a ledger row stands for money that moved, so inventing one would leave an entry
 * no movement explains. The seeds write completed cash flows straight to their table, so this runs
 * the same reconcile the nightly cron does, which is already a top-up: every write is idempotent
 * on its movement, so a re-run inserts only what is missing. The limit is raised past the demo
 * volume so one run catches everything.
 */
export const clientLedgerSeed: SeedDefinition = {
	name: 'client-ledger',
	run: async ({ manager }): Promise<SeedSummary> => {
		const repository = manager.getRepository(ClientLedgerEntity);

		const alreadyPresent = await repository.count();

		await clientLedgerService.reconcile(10_000, manager);

		const tableTotal = await repository.count();

		return {
			entity: 'client-ledger',
			alreadyPresent: alreadyPresent,
			inserted: tableTotal - alreadyPresent,
			target: tableTotal,
			tableTotal: tableTotal,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(clientLedgerSeed);
}
