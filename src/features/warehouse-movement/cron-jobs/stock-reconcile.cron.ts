import { Configuration } from '@/config/settings.config';
import { stockReportService } from '@/features/warehouse-movement/stock-report.service';
import { stockReservationService } from '@/features/warehouse-movement/stock-reservation.service';
import { warehouseMovementService } from '@/features/warehouse-movement/warehouse-movement.service';
import { loadEmailTemplate, queueEmail } from '@/providers/email.provider';

export const SCHEDULE_EXPRESSION = '15 02 * * *';
export const EXPECTED_RUN_TIME = 20; // seconds

/** Rows per list in the digest; the first rows of a long list name the problem. */
const REPORT_LIMIT = 50;

/**
 * Catches stock up, then reports what does not add up.
 *
 * **Catch-up first.** Receipts confirmed, orders placed and deliveries shipped while this feature
 * was not installed hold no ledger rows or reservations; the three backfills post them, in the
 * order they have to run (reservations before shipments, which then lower them). Each is
 * idempotent and batched, so a backlog clears over consecutive nights.
 *
 * **Then the report** - lots whose ledger does not explain them, reservations that disagree with
 * their order, and variants promised beyond what is on hand. Mailed to `app.email` only when
 * something was found; nothing is corrected (see `StockReportService`).
 *
 * Daily, at night, after the client ledger's own reconcile.
 */
const stockReconcile = async () => {
	const receipts = await warehouseMovementService.backfill();
	const reservations = await stockReservationService.backfill();
	const shipments = await warehouseMovementService.backfillShipments();

	const lots = await stockReportService.findLotDrift(REPORT_LIMIT);
	const reservationDrift =
		await stockReportService.findReservationDrift(REPORT_LIMIT);
	const overCommitted =
		await stockReportService.findOverCommitted(REPORT_LIMIT);

	const findings =
		lots.length + reservationDrift.length + overCommitted.length;

	if (findings > 0) {
		const emailTemplate = await loadEmailTemplate(
			'stock-reconcile',
			Configuration.language(),
		);

		emailTemplate.content.vars = {
			lots: lots,
			lotCount: lots.length,
			reservations: reservationDrift,
			reservationCount: reservationDrift.length,
			overCommitted: overCommitted.map((row) => ({
				sku: row.sku,
				on_hand: row.on_hand,
				reserved: row.reserved,
				available: row.available,
			})),
			overCommittedCount: overCommitted.length,
			limit: REPORT_LIMIT,
		};

		await queueEmail(emailTemplate, {
			name: Configuration.get('app.name'),
			address: Configuration.get('app.email'),
		});
	}

	return {
		backfilled: {
			grn_items: receipts.grn_items,
			orders: reservations.orders,
			shippings: shipments.shippings,
		},
		drift: {
			lots: lots.length,
			reservations: reservationDrift.length,
		},
		over_committed: overCommitted.length,
	};
};

export default stockReconcile;
