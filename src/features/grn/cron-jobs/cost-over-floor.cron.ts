import { Configuration } from '@/config/settings.config';
import { resolveBaseCurrency } from '@/features/exchange-rate/exchange-rate.entity';
import { grnService } from '@/features/grn/grn.service';
import { loadEmailTemplate, queueEmail } from '@/providers/email.provider';

// After `stock-low` (06:30), so the purchasing mails arrive together
export const SCHEDULE_EXPRESSION = '35 06 * * *';
export const EXPECTED_RUN_TIME = 5; // seconds

/** Rows in the digest, tightest first; the rest are on `GET /grns/cost-over-floor`. */
const REPORT_LIMIT = 100;

/**
 * Mails the price rows whose floor - `min_price`, or `sale_price` where none is set - is at or
 * under the variant's `cost_price`, to `app.email`. Cost never moves a price on its own (see
 * `product_variant.cost_price`); this is the prompt for a person to reprice.
 *
 * A daily report of the current state rather than a mail per receipt: the gap stays listed every
 * morning until a price or the cost closes it, and a price edit that opens one is caught as well
 * as a receipt. Nothing is sent when nothing is under.
 */
const costOverFloor = async () => {
	const [rows, total] = await grnService.findCostOverFloor(1, REPORT_LIMIT);

	if (total > 0) {
		const emailTemplate = await loadEmailTemplate(
			'cost-over-floor',
			Configuration.language(),
		);

		emailTemplate.content.vars = {
			rows: rows.map((row) => ({
				sku: row.sku,
				currency: row.currency,
				floor: row.min_price ?? row.sale_price,
				floor_label:
					row.min_price === null ? 'sale price' : 'min price',
				floor_base: row.floor_base,
				cost_price: row.cost_price,
			})),
			base_currency: resolveBaseCurrency(),
			total: total,
		};

		await queueEmail(emailTemplate, {
			name: Configuration.get('app.name'),
			address: Configuration.get('app.email'),
		});
	}

	return {
		cost_over_floor: total,
	};
};

export default costOverFloor;
