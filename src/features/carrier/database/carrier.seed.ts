import {
	isDirectRun,
	randomInt,
	type SeedDefinition,
	type SeedSummary,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import CarrierEntity from '@/features/carrier/carrier.entity';

/**
 * Real couriers, paired with the domain they are reachable under. International names sit
 * next to the local ones an shipping row realistically picks from.
 *
 * The domain is stored rather than derived from the name: `Fan Courier` → `fancourier.ro`
 * loses the space, `DPD` → `dpd.com` lowercases, and a rule covering both is longer than
 * the column it replaces.
 */
const CARRIERS: ReadonlyArray<readonly [name: string, domain: string]> = [
	['DHL Express', 'dhl.com'],
	['FedEx', 'fedex.com'],
	['UPS', 'ups.com'],
	['DPD', 'dpd.com'],
	['GLS', 'gls-group.com'],
	['TNT', 'tnt.com'],
	['Fan Courier', 'fancourier.ro'],
	['Cargus', 'cargus.ro'],
	['Sameday', 'sameday.ro'],
	['Nemo Express', 'nemoexpress.ro'],
] as const;

const TARGET = CARRIERS.length;

export const carrierSeed: SeedDefinition = {
	name: 'carrier',
	run: async ({ manager, random }): Promise<SeedSummary> =>
		topUp({
			entity: 'carrier',
			target: TARGET,
			manager,
			entityClass: CarrierEntity,
			// Unique index on the live rows, so it is also the natural key for a top-up
			keyColumn: 'name',
			buildRow: (index) => {
				const [name, domain] = CARRIERS[index];

				return {
					name,
					website: `https://www.${domain}`,
					phone: `+407${randomInt(random, 10000000, 99999999)}`,
					email: `contact@${domain}`,
					notes: null,
				};
			},
		}),
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(carrierSeed);
}
