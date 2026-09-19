import { invoiceService } from '@/features/invoice/invoice.service';

export const SCHEDULE_EXPRESSION = '30 01 * * *';
export const EXPECTED_RUN_TIME = 5; // seconds

/**
 * Stamps `overdue_at` on issued invoices that have gone past their due date unsettled.
 *
 * Daily, shortly after midnight: a due date is a date, so going late is a once-a-day event and
 * nothing reads the column more often than a dunning run does.
 *
 * The column is deliberately never cleared - see the entity comment on `overdue_at` - so a row is
 * stamped once and leaves the partial index the sweep reads. Batched for that reason too: a
 * backlog clears over consecutive runs instead of one statement holding locks over the table.
 */
const invoiceOverdue = async () => {
	const stamped = await invoiceService.stampOverdue();

	return {
		stamped,
	};
};

export default invoiceOverdue;
