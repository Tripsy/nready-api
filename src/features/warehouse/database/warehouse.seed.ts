import {
	isDirectRun,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import AddressEntity from '@/features/address/address.entity';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';

const TARGET = 8;

/**
 * City code and the name it reads as, paired so the row stays a pure function of the index -
 * which `topUp` requires, and which the unique `code` makes worth getting right.
 */
const WAREHOUSE_SITES: ReadonlyArray<readonly [string, string]> = [
	['BUC', 'Bucharest Central'],
	['CLJ', 'Cluj Distribution'],
	['TMS', 'Timisoara Depot'],
	['IAS', 'Iasi Regional'],
	['CTA', 'Constanta Port'],
	['BRA', 'Brasov Hub'],
	['SBI', 'Sibiu Storage'],
	['ORA', 'Oradea Transit'],
] as const;

export const warehouseSeed: SeedDefinition = {
	name: 'warehouse',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		// Any address will do as a parent; the seed only needs the reference to be valid.
		const addresses = await manager.getRepository(AddressEntity).find({
			select: { id: true },
			order: { id: 'ASC' },
		});

		if (addresses.length === 0) {
			throw new Error(
				'No addresses found - run the address seed before the warehouse seed',
			);
		}

		const addressIds = addresses.map((address) => address.id);

		/*
		 * `IDX_warehouse_default` allows one default across the table, so the seed may only
		 * claim it when nothing holds it yet. Checked with `withDeleted`, since a soft-deleted
		 * row leaves the flag free - the index excludes it.
		 */
		const existingDefault = await manager
			.getRepository(WarehouseEntity)
			.findOne({
				select: { id: true },
				where: { is_default: true },
			});

		const canClaimDefault = existingDefault === null;

		return topUp({
			entity: 'warehouse',
			target: TARGET,
			manager,
			entityClass: WarehouseEntity,
			keyColumn: 'code',
			buildRow: (index) => {
				const [cityCode, siteName] =
					WAREHOUSE_SITES[index % WAREHOUSE_SITES.length];

				return {
					address_id: randomPick(random, addressIds),
					code: `${cityCode}-${String(index + 1).padStart(2, '0')}`,
					name: siteName,
					// The first site is the one a single-location business would ship from
					is_default: canClaimDefault && index === 0,
					status: randomPick(random, [
						WarehouseStatusEnum.ACTIVE,
						WarehouseStatusEnum.ACTIVE,
						WarehouseStatusEnum.ACTIVE,
						WarehouseStatusEnum.INACTIVE,
					]),
					notes: null,
				};
			},
		});
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(warehouseSeed);
}
