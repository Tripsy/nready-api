import {
	BNR_PROVIDER,
	fetchBnrBulletin,
} from '@/features/exchange-rate/cron-jobs/bnr.client';
import {
	exchangeRateService,
	type ImportedRate,
} from '@/features/exchange-rate/exchange-rate.service';
import { getSystemLogger } from '@/providers/logger.provider';

/**
 * 13:20, working days only - BNR publishes the day's reference rates around 13:00.
 *
 * The expression is read in whatever `APP_TIMEZONE` the deployment sets (`Europe/Bucharest` in
 * `.env.example`), which is the timezone the publication hour is stated in. A deployment running
 * on UTC reads it three hours late in Bucharest terms, which is still after publication; one set
 * to a timezone ahead of Bucharest runs before it and reads the previous working day's bulletin
 * instead - correct data, a day behind, and `filterAsOf` carries the last publication forward so
 * a conversion still resolves.
 *
 * Weekends are skipped because there is nothing new to read: the file keeps the last working
 * day's `Cube`, which by then is already stored.
 */
export const SCHEDULE_EXPRESSION = '20 13 * * 1-5';
export const EXPECTED_RUN_TIME = 10; // seconds - one small HTTP round trip

/**
 * The currencies taken from the bulletin. BNR quotes around forty; storing the rest would be
 * rows nothing reads, and every one of them is a row per day forever.
 *
 * **This is the edit point when a deployment starts trading in another currency.** A code added
 * here is imported from the next run on; the days before it stay unquoted, which `filterAsOf`
 * reports as no rate rather than a wrong one. Do not list the base currency itself - a row
 * priced against its own currency is refused by the table's check constraint.
 */
export const IMPORTED_CURRENCIES: readonly string[] = ['EUR', 'USD'];

/**
 * Brings BNR's daily reference rates into `exchange_rate`.
 *
 * Direction follows the bulletin, and it is the one the consumers need: BNR quotes everything
 * *into* RON (`OrigCurrency`), so a row reads "one EUR is worth 5.2575 RON" - `currency` the
 * foreign one, `base_currency` what the bulletin quotes into.
 *
 * The run is idempotent: re-reading a bulletin already stored changes nothing, and a rate a
 * person corrected by hand is never written over.
 */
const importExchangeRate = async () => {
	const bulletin = await fetchBnrBulletin();

	const rates: ImportedRate[] = [];
	const missing: string[] = [];

	for (const currency of IMPORTED_CURRENCIES) {
		const rate = bulletin.rates[currency];

		if (rate === undefined) {
			missing.push(currency);
			continue;
		}

		rates.push({
			currency,
			base_currency: bulletin.base_currency,
			rate,
		});
	}

	if (missing.length > 0) {
		// Not a failure: BNR drops a currency it has no quote for that day, and the previous
		// publication stays in force. Worth a line, because a code that is missing every run is
		// a typo in the list above
		getSystemLogger().warn(
			{ rate_date: bulletin.rate_date, missing },
			`BNR bulletin quotes no rate for ${missing.join(', ')}`,
		);
	}

	const summary = await exchangeRateService.importRates(
		bulletin.rate_date,
		rates,
		BNR_PROVIDER,
	);

	return {
		rate_date: bulletin.rate_date,
		base_currency: bulletin.base_currency,
		...summary,
		missing: missing.join(', '),
	};
};

export default importExchangeRate;
