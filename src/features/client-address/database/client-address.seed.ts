import {
	isDirectRun,
	loadIds,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import AddressEntity from '@/features/address/address.entity';
import ClientEntity from '@/features/client/client.entity';
import ClientAddressEntity, {
	ClientAddressTypeEnum,
} from '@/features/client-address/client-address.entity';

const TARGET = 40;

const NOTES = [
	null,
	null,
	'Ring twice',
	'Entrance from the back',
	'Call before arriving',
] as const;

export const clientAddressSeed: SeedDefinition = {
	name: 'client-address',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const clientIds = await loadIds(manager, ClientEntity);

		if (clientIds.length === 0) {
			throw new Error(
				'No clients found - run the client seed before the client-address seed',
			);
		}

		// Any address will do, including one another client or a warehouse already uses - an
		// address is shared, and a client address only points at it
		const addressIds = await loadIds(manager, AddressEntity);

		if (addressIds.length === 0) {
			throw new Error(
				'No addresses found - run the address seed before the client-address seed',
			);
		}

		return topUp({
			entity: 'client-address',
			target: TARGET,
			manager,
			entityClass: ClientAddressEntity,
			// `details` doubles as the natural key - the apartment number is derived from the index,
			// which keeps it distinct
			keyColumn: 'details',
			buildRow: (index) => ({
				client_id: randomPick(random, clientIds),
				address_id: randomPick(random, addressIds),
				type: randomPick(random, Object.values(ClientAddressTypeEnum)),
				details: `Ap. ${sequenceLabel(index, 3)}, floor ${randomInt(random, 0, 10)}`,
				notes: randomPick(random, NOTES),
			}),
		});
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(clientAddressSeed);
}
