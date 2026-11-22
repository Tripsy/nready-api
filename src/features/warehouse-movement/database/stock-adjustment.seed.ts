import {
	isDirectRun,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import { GrnStatusEnum } from '@/features/grn/grn.entity';
import { WarehouseStatusEnum } from '@/features/warehouse/warehouse.entity';
import StockAdjustmentEntity, {
	STOCK_ADJUSTMENT_REASONS,
	StockAdjustmentDirectionEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import { stockAdjustmentService } from '@/features/warehouse-movement/stock-adjustment.service';

const TARGET = 6;

/**
 * Units a site must hold beyond what orders reserve before the seed touches it - a demo removal
 * must never leave a seeded delivery with nothing to ship.
 */
const SLACK = 10;

type SiteStock = { warehouse_id: number; variant_id: number };

/**
 * A few adjustments over the seeded receipts, so the adjustments page and the ledger have
 * something to show: removals for every other row, and an addition of what the previous one took,
 * which the lots it was drawn from always have room for.
 *
 * Posted through `StockAdjustmentService` rather than inserted: an adjustment is only true if its
 * lots moved and its movements were written, and the service is what does both. The natural key
 * is `notes`, which carries the sequence number - a re-run finds each already there and posts
 * nothing, since posting again would move the stock a second time.
 */
export const stockAdjustmentSeed: SeedDefinition = {
	name: 'stock-adjustment',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(StockAdjustmentEntity);

		const existing = new Set(
			(await repository.find({ select: { notes: true } })).map(
				(row) => row.notes,
			),
		);

		const rows = await manager.query<
			{ warehouse_id: number; variant_id: number }[]
		>(
			`SELECT grn.warehouse_id, item.variant_id
			   FROM grn_item item
			   JOIN grn ON grn.id = item.grn_id AND grn.deleted_at IS NULL AND grn.status = $1
			   JOIN warehouse ON warehouse.id = grn.warehouse_id AND warehouse.status = $2
			   JOIN product_variant variant ON variant.id = item.variant_id
			        AND variant.track_stock AND variant.deleted_at IS NULL
			  WHERE item.deleted_at IS NULL
			  GROUP BY grn.warehouse_id, item.variant_id
			 HAVING SUM(item.qty_remaining) - COALESCE((
			          SELECT SUM(reservation.quantity)
			            FROM stock_reservation reservation
			           WHERE reservation.variant_id = item.variant_id
			        ), 0) >= $3
			  ORDER BY grn.warehouse_id, item.variant_id`,
			[GrnStatusEnum.CONFIRMED, WarehouseStatusEnum.ACTIVE, SLACK],
		);

		const sites: SiteStock[] = rows.map((row) => ({
			warehouse_id: Number(row.warehouse_id),
			variant_id: Number(row.variant_id),
		}));

		let alreadyPresent = 0;
		let inserted = 0;

		if (sites.length > 0) {
			let previous: { site: SiteStock; units: number } | null = null;

			for (let index = 0; index < TARGET; index++) {
				const isRemoval = index % 2 === 0;
				const notes = `Demo stock adjustment ${sequenceLabel(index)}`;

				// Drawn before the skip, so a re-run walks the same sequence and keys line up
				const site: SiteStock =
					isRemoval || !previous
						? randomPick(random, sites)
						: previous.site;
				const units: number =
					isRemoval || !previous
						? randomInt(random, 1, 3)
						: previous.units;
				const direction = isRemoval
					? StockAdjustmentDirectionEnum.REMOVE
					: StockAdjustmentDirectionEnum.ADD;
				const reason = randomPick(
					random,
					STOCK_ADJUSTMENT_REASONS[direction],
				);

				previous = isRemoval ? { site, units } : null;

				if (existing.has(notes)) {
					alreadyPresent++;
					continue;
				}

				await stockAdjustmentService.createWithin(manager, {
					warehouse_id: site.warehouse_id,
					variant_id: site.variant_id,
					direction: direction,
					qty: units,
					reason: reason,
					notes: notes,
				});

				inserted++;
			}
		}

		return {
			entity: 'stock-adjustment',
			alreadyPresent: alreadyPresent,
			inserted: inserted,
			target: TARGET,
			tableTotal: await repository.count(),
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(stockAdjustmentSeed);
}
