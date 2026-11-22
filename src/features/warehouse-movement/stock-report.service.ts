import type { EntityManager } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { GrnStatusEnum } from '@/features/grn/grn.entity';
import { WarehouseStatusEnum } from '@/features/warehouse/warehouse.entity';
import {
	GONE_DELIVERY_SQL,
	RESERVING_STATUSES,
} from '@/features/warehouse-movement/stock-reservation.service';

/** A lot whose ledger no longer explains its balance. */
export type LotDrift = {
	grn_item_id: number;
	variant_id: number;
	warehouse_id: number;
	qty_remaining: number; // What the lot says it holds
	ledger: number; // What its movements add up to
};

/** An order whose reservation disagrees with what it still needs. */
export type ReservationDrift = {
	order_id: number;
	order_status: string;
	variant_id: number;
	reserved: number; // What `stock_reservation` holds
	expected: number; // Tracked lines, less what its deliveries already took away
};

/** A tracked variant's figures, across active warehouses and live orders. */
export type VariantAvailability = {
	variant_id: number;
	product_id: number;
	sku: string;
	on_hand: number;
	reserved: number;
	available: number;
	low_stock_threshold: number | null;
};

/**
 * Per-variant on hand and reserved, as `StockReservationService` computes them for a single
 * variant: open lots on confirmed, live receipts in active warehouses, and reservations of live
 * orders. One CTE so every report reads the same definition. Built from enum constants only.
 */
const AVAILABILITY_CTE = `
	on_hand AS (
		SELECT grn_item.variant_id, SUM(grn_item.qty_remaining) AS on_hand
		FROM grn_item
		INNER JOIN grn ON grn.id = grn_item.grn_id
			AND grn.deleted_at IS NULL
			AND grn.status = '${GrnStatusEnum.CONFIRMED}'
		INNER JOIN warehouse ON warehouse.id = grn.warehouse_id
			AND warehouse.status = '${WarehouseStatusEnum.ACTIVE}'
		WHERE grn_item.qty_remaining > 0 AND grn_item.deleted_at IS NULL
		GROUP BY grn_item.variant_id
	),
	reserved AS (
		SELECT stock_reservation.variant_id, SUM(stock_reservation.quantity) AS reserved
		FROM stock_reservation
		INNER JOIN "order" ON "order".id = stock_reservation.order_id
			AND "order".deleted_at IS NULL
		GROUP BY stock_reservation.variant_id
	),
	availability AS (
		SELECT
			product_variant.id AS variant_id,
			product_variant.product_id,
			product_variant.sku,
			product_variant.low_stock_threshold,
			COALESCE(on_hand.on_hand, 0) AS on_hand,
			COALESCE(reserved.reserved, 0) AS reserved,
			COALESCE(on_hand.on_hand, 0) - COALESCE(reserved.reserved, 0) AS available
		FROM product_variant
		LEFT JOIN on_hand ON on_hand.variant_id = product_variant.id
		LEFT JOIN reserved ON reserved.variant_id = product_variant.id
		WHERE product_variant.track_stock = true
			AND product_variant.deleted_at IS NULL
	)
`;

type AvailabilityRow = {
	variant_id: number;
	product_id: number;
	sku: string;
	on_hand: string;
	reserved: string;
	available: string;
	low_stock_threshold: number | null;
};

function toAvailability(row: AvailabilityRow): VariantAvailability {
	return {
		variant_id: Number(row.variant_id),
		product_id: Number(row.product_id),
		sku: row.sku,
		on_hand: Number(row.on_hand),
		reserved: Number(row.reserved),
		available: Number(row.available),
		low_stock_threshold:
			row.low_stock_threshold === null
				? null
				: Number(row.low_stock_threshold),
	};
}

/**
 * Reads over stock that look for trouble rather than answer a question about one row.
 *
 * **Drift is reported, never corrected.** Every figure here has a single writer working inside the
 * transaction that moves the goods, so a disagreement means something wrote around it - a
 * hand-edited row, an import, a bug. Correcting it silently would erase the evidence of which;
 * the reconcile cron mails the findings for a person to read.
 *
 * Each query is capped by `limit`: a drift report of thousands of rows is one problem repeated,
 * and the first rows name it.
 */
export class StockReportService {
	/**
	 * @description Used in `stock-reconcile.cron.ts`
	 *
	 * Lots whose movements do not add up to `qty_remaining`. Every lot on a receipt that was ever
	 * confirmed is checked: a canceled one should read 0 on both sides (its receipt and the
	 * reversal), an open one its receipt less what has left.
	 */
	public async findLotDrift(
		limit: number = 50,
		manager: EntityManager = dataSource.manager,
	): Promise<LotDrift[]> {
		const rows = await manager.query<
			{
				grn_item_id: number;
				variant_id: number;
				warehouse_id: number;
				qty_remaining: string;
				ledger: string;
			}[]
		>(
			`
				SELECT
					grn_item.id AS grn_item_id,
					grn_item.variant_id,
					grn.warehouse_id,
					grn_item.qty_remaining,
					COALESCE(SUM(warehouse_movement.qty), 0) AS ledger
				FROM grn_item
				INNER JOIN grn ON grn.id = grn_item.grn_id
				LEFT JOIN warehouse_movement ON warehouse_movement.grn_item_id = grn_item.id
				WHERE grn.confirmed_at IS NOT NULL
				GROUP BY grn_item.id, grn.warehouse_id
				HAVING COALESCE(SUM(warehouse_movement.qty), 0) <> grn_item.qty_remaining
				ORDER BY grn_item.id
				LIMIT $1
			`,
			[limit],
		);

		return rows.map((row) => ({
			grn_item_id: Number(row.grn_item_id),
			variant_id: Number(row.variant_id),
			warehouse_id: Number(row.warehouse_id),
			qty_remaining: Number(row.qty_remaining),
			ledger: Number(row.ledger),
		}));
	}

	/**
	 * @description Used in `stock-reconcile.cron.ts`
	 *
	 * Reservations that disagree with the order behind them, both ways:
	 *
	 * - **A live `pending` or `confirmed` order** should hold its tracked physical lines (a bundle
	 *   header stands for nothing, its components do), less what its deliveries already took away
	 *   (`GONE_DELIVERY_SQL`), never below zero.
	 * - **A canceled or completed order** should hold nothing - both release on the way there.
	 *
	 * A soft-deleted order is left out: its rows are ignored by availability on purpose, so that a
	 * restore brings them back.
	 */
	public async findReservationDrift(
		limit: number = 50,
		manager: EntityManager = dataSource.manager,
	): Promise<ReservationDrift[]> {
		const rows = await manager.query<
			{
				order_id: number;
				order_status: string;
				variant_id: number;
				reserved: string;
				expected: string;
			}[]
		>(
			`
				WITH demand AS (
					SELECT order_line.order_id, order_line.variant_id, SUM(order_line.quantity) AS quantity
					FROM order_line
					INNER JOIN "order" ON "order".id = order_line.order_id
						AND "order".deleted_at IS NULL
						AND "order".status = ANY($1)
					INNER JOIN product_variant ON product_variant.id = order_line.variant_id
						AND product_variant.track_stock = true
					WHERE order_line.deleted_at IS NULL
						AND NOT EXISTS (
							SELECT 1 FROM order_line child
							WHERE child.parent_id = order_line.id AND child.deleted_at IS NULL
						)
					GROUP BY order_line.order_id, order_line.variant_id
				),
				gone AS (
					SELECT shipping.order_id, shipping_line.variant_id, SUM(shipping_line.quantity) AS quantity
					FROM shipping_line
					INNER JOIN shipping ON shipping.id = shipping_line.shipping_id
					WHERE shipping.order_id IN (SELECT order_id FROM demand)
						AND ${GONE_DELIVERY_SQL}
					GROUP BY shipping.order_id, shipping_line.variant_id
				),
				expected AS (
					SELECT demand.order_id, demand.variant_id,
						GREATEST(demand.quantity - COALESCE(gone.quantity, 0), 0) AS quantity
					FROM demand
					LEFT JOIN gone ON gone.order_id = demand.order_id
						AND gone.variant_id = demand.variant_id
				),
				actual AS (
					SELECT stock_reservation.order_id, stock_reservation.variant_id, stock_reservation.quantity
					FROM stock_reservation
					INNER JOIN "order" ON "order".id = stock_reservation.order_id
						AND "order".deleted_at IS NULL
				)
				SELECT
					COALESCE(expected.order_id, actual.order_id) AS order_id,
					"order".status AS order_status,
					COALESCE(expected.variant_id, actual.variant_id) AS variant_id,
					COALESCE(actual.quantity, 0) AS reserved,
					COALESCE(expected.quantity, 0) AS expected
				FROM expected
				FULL OUTER JOIN actual ON actual.order_id = expected.order_id
					AND actual.variant_id = expected.variant_id
				INNER JOIN "order" ON "order".id = COALESCE(expected.order_id, actual.order_id)
				WHERE COALESCE(actual.quantity, 0) <> COALESCE(expected.quantity, 0)
				ORDER BY 1, 3
				LIMIT $2
			`,
			[RESERVING_STATUSES, limit],
		);

		return rows.map((row) => ({
			order_id: Number(row.order_id),
			order_status: row.order_status,
			variant_id: Number(row.variant_id),
			reserved: Number(row.reserved),
			expected: Number(row.expected),
		}));
	}

	/**
	 * @description Used in `stock-reconcile.cron.ts`
	 *
	 * Tracked variants promised beyond what is on hand. Not drift - it happens legitimately when a
	 * confirmed receipt is canceled under orders already placed, or a variant sold on backorder -
	 * but every one is an order that cannot ship as things stand, which is what someone needs to
	 * see. Most over-committed first.
	 */
	public async findOverCommitted(
		limit: number = 50,
		manager: EntityManager = dataSource.manager,
	): Promise<VariantAvailability[]> {
		const rows = await manager.query<AvailabilityRow[]>(
			`
				WITH ${AVAILABILITY_CTE}
				SELECT * FROM availability
				WHERE available < 0
				ORDER BY available ASC, variant_id ASC
				LIMIT $1
			`,
			[limit],
		);

		return rows.map(toAvailability);
	}

	/**
	 * @description Used in `lowStock` method from controller, and in `stock-low.cron.ts`
	 *
	 * Tracked variants at or under their `low_stock_threshold`, measured on **available** rather
	 * than on hand: units already promised are not there to sell. A variant with no threshold is
	 * never listed - it has not asked to be watched. Lowest first, so the most urgent lead.
	 */
	public async findLowStock(
		page: number = 1,
		limit: number = 50,
		manager: EntityManager = dataSource.manager,
	): Promise<[VariantAvailability[], number]> {
		const rows = await manager.query<
			(AvailabilityRow & { total: string })[]
		>(
			`
				WITH ${AVAILABILITY_CTE}
				SELECT *, COUNT(*) OVER () AS total FROM availability
				WHERE low_stock_threshold IS NOT NULL
					AND available <= low_stock_threshold
				ORDER BY available ASC, variant_id ASC
				LIMIT $1 OFFSET $2
			`,
			[limit, (page - 1) * limit],
		);

		// The total rides on the rows as a window count - one query, at the cost of a page past the
		// end reporting 0 rather than the real total
		return [
			rows.map(toAvailability),
			rows.length > 0 ? Number(rows[0].total) : 0,
		];
	}
}

export const stockReportService = new StockReportService();
