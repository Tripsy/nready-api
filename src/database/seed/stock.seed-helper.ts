import type { EntityManager } from 'typeorm';

/**
 * What each active warehouse can still send, per variant: `warehouse_id -> variant_id -> qty`.
 *
 * Shared by the order and shipping seeds so the demo book only promises goods a site holds -
 * otherwise a pending delivery picks from a warehouse with nothing on its shelves and shipping it
 * answers 409, and reservations outrun the stock.
 *
 * Read with raw SQL behind a table check rather than through `grn`'s entities: neither `order` nor
 * `shipping` depends on `grn` (an optional feature), and a seed importing it would break the moment
 * `cli/feature.ts` removes it. The statuses are written out for the same reason - they mirror
 * `GrnStatusEnum.CONFIRMED` and `WarehouseStatusEnum.ACTIVE`.
 */
export type SiteStock = Map<number, Map<number, number>>;

async function tableExists(
	manager: EntityManager,
	table: string,
): Promise<boolean> {
	const [row] = await manager.query<{ found: string | null }[]>(
		'SELECT to_regclass($1) AS found',
		[`public.${table}`],
	);

	return !!row?.found;
}

/**
 * Null when the receipt tables are not installed - stock is not tracked then, so nothing
 * constrains a seed. Otherwise the open lots of confirmed receipts in active warehouses, less what
 * live deliveries already picked from each site but have not drawn yet (no `sale` on the ledger:
 * a seeded delivery is only drawn once `warehouseMovementSeed` backfills it).
 */
export async function loadSiteStock(
	manager: EntityManager,
): Promise<SiteStock | null> {
	if (!(await tableExists(manager, 'grn_item'))) {
		return null;
	}

	const stock: SiteStock = new Map();

	const lots = await manager.query<
		{ warehouse_id: number; variant_id: number; qty: string }[]
	>(
		`SELECT grn.warehouse_id, grn_item.variant_id, SUM(grn_item.qty_remaining) AS qty
		 FROM grn_item
		 INNER JOIN grn ON grn.id = grn_item.grn_id
		     AND grn.status = 'confirmed' AND grn.deleted_at IS NULL
		 INNER JOIN warehouse ON warehouse.id = grn.warehouse_id
		     AND warehouse.status = 'active' AND warehouse.deleted_at IS NULL
		 WHERE grn_item.qty_remaining > 0
		 GROUP BY grn.warehouse_id, grn_item.variant_id`,
	);

	for (const lot of lots) {
		adjust(
			stock,
			Number(lot.warehouse_id),
			Number(lot.variant_id),
			Number(lot.qty),
		);
	}

	const hasLedger = await tableExists(manager, 'warehouse_movement');

	const undrawn = await manager.query<
		{ warehouse_id: number; variant_id: number; qty: string }[]
	>(
		`SELECT shipping.pickup_warehouse_id AS warehouse_id, line.variant_id, SUM(line.quantity) AS qty
		 FROM shipping_line line
		 INNER JOIN shipping ON shipping.id = line.shipping_id AND shipping.deleted_at IS NULL
		 WHERE shipping.scope = 'delivery'
		     AND shipping.status NOT IN ('failed', 'canceled', 'returned')
		     AND shipping.pickup_warehouse_id IS NOT NULL
		     ${
					hasLedger
						? `AND NOT EXISTS (
		         SELECT 1 FROM warehouse_movement movement
		         WHERE movement.source_type = 'shipping_line'
		             AND movement.source_id = line.id
		             AND movement.movement_type = 'sale'
		     )`
						: ''
}
		 GROUP BY shipping.pickup_warehouse_id, line.variant_id`,
	);

	for (const row of undrawn) {
		adjust(
			stock,
			Number(row.warehouse_id),
			Number(row.variant_id),
			-Number(row.qty),
		);
	}

	return stock;
}

/** Ids of the variants whose stock is tracked - the only ones a site's shelves constrain. */
export async function loadTrackedVariantIds(
	manager: EntityManager,
): Promise<Set<number>> {
	const rows = await manager.query<{ id: number }[]>(
		'SELECT id FROM product_variant WHERE track_stock AND deleted_at IS NULL',
	);

	return new Set(rows.map((row) => Number(row.id)));
}

export function available(
	stock: SiteStock,
	warehouseId: number,
	variantId: number,
): number {
	return stock.get(warehouseId)?.get(variantId) ?? 0;
}

/** Moves a site's figure for a variant by `delta`, kept to the cent. */
export function adjust(
	stock: SiteStock,
	warehouseId: number,
	variantId: number,
	delta: number,
): void {
	const site = stock.get(warehouseId) ?? new Map<number, number>();

	site.set(
		variantId,
		Math.round(((site.get(variantId) ?? 0) + delta) * 100) / 100,
	);
	stock.set(warehouseId, site);
}

/**
 * Whether one site can send every tracked line of a consignment in full. Untracked lines travel
 * from anywhere.
 */
export function canFill(
	stock: SiteStock,
	warehouseId: number,
	lines: readonly { variant_id: number; quantity: number }[],
	tracked: ReadonlySet<number>,
): boolean {
	return lines.every(
		(line) =>
			!tracked.has(line.variant_id) ||
			available(stock, warehouseId, line.variant_id) >=
				Number(line.quantity),
	);
}
