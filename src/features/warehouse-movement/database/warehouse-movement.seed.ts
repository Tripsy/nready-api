import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import StockReservationEntity from '@/features/warehouse-movement/stock-reservation.entity';
import { stockReservationService } from '@/features/warehouse-movement/stock-reservation.service';
import WarehouseMovementEntity from '@/features/warehouse-movement/warehouse-movement.entity';
import { warehouseMovementService } from '@/features/warehouse-movement/warehouse-movement.service';

/**
 * Demo stock: the movements the seeded goods receipts and deliveries imply, and the reservations
 * the seeded orders imply.
 *
 * Not generated - a movement stands for stock that moved and a reservation for an order that
 * promised it, so inventing either would leave a row nothing explains. The receipt and order seeds
 * go through their services, but seeds run without the bootstraps that fill `grn.hooks.ts` and
 * `order.hooks.ts`, so nothing is posted there. This runs both backfills instead, each already a
 * top-up: only lots with no receipt row and orders with no reservation are picked, so a re-run
 * inserts nothing new. The limit is raised past the demo volume so one run catches everything.
 */
export const warehouseMovementSeed: SeedDefinition = {
	name: 'warehouse-movement',
	run: async ({ manager }): Promise<SeedSummary> => {
		const movements = manager.getRepository(WarehouseMovementEntity);
		const reservations = manager.getRepository(StockReservationEntity);

		const alreadyPresent =
			(await movements.count()) + (await reservations.count());

		await warehouseMovementService.backfill(10_000, manager);
		await stockReservationService.backfill(10_000, manager);
		// After the reservations: they leave shipped goods out, so the two agree (see the method)
		await warehouseMovementService.backfillShipments(10_000, manager);

		const tableTotal =
			(await movements.count()) + (await reservations.count());

		return {
			entity: 'warehouse-movement',
			alreadyPresent: alreadyPresent,
			inserted: tableTotal - alreadyPresent,
			target: tableTotal,
			tableTotal: tableTotal,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(warehouseMovementSeed);
}
