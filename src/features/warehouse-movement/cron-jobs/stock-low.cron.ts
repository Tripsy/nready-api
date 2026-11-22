import { Configuration } from '@/config/settings.config';
import { stockReportService } from '@/features/warehouse-movement/stock-report.service';
import { loadEmailTemplate, queueEmail } from '@/providers/email.provider';

export const SCHEDULE_EXPRESSION = '30 06 * * *';
export const EXPECTED_RUN_TIME = 5; // seconds

/** Rows in the digest; the rest are on `GET /warehouse-movements/low-stock`. */
const REPORT_LIMIT = 100;

/**
 * Mails the variants at or under their low-stock threshold, lowest first, to `app.email` - in the
 * morning, ahead of the working day's purchasing. Nothing is sent when nothing is low. The same
 * list, paginated, is `GET /warehouse-movements/low-stock`.
 */
const stockLow = async () => {
	const [variants, total] = await stockReportService.findLowStock(
		1,
		REPORT_LIMIT,
	);

	if (total > 0) {
		const emailTemplate = await loadEmailTemplate(
			'stock-low',
			Configuration.language(),
		);

		emailTemplate.content.vars = {
			// The query lists only variants with a threshold; `?? 0` narrows the type for the template
			variants: variants.map((row) => ({
				sku: row.sku,
				on_hand: row.on_hand,
				reserved: row.reserved,
				available: row.available,
				low_stock_threshold: row.low_stock_threshold ?? 0,
			})),
			total: total,
		};

		await queueEmail(emailTemplate, {
			name: Configuration.get('app.name'),
			address: Configuration.get('app.email'),
		});
	}

	return {
		low_stock: total,
	};
};

export default stockLow;
