import { expect, jest } from '@jest/globals';
import { Configuration } from '@/config/settings.config';
import { CustomError } from '@/exceptions';
import { VatCategoryEnum } from '@/features/vat-rate/vat-rate.entity';
import {
	pickRatesInForce,
	rateFor,
	toVatDay,
	type VatRateRow,
} from '@/features/vat-rate/vat-rate.service';

const romania: VatRateRow[] = [
	{
		country_code: 'RO',
		category: 'standard',
		rate: 19,
		valid_from: '2017-01-01',
	},
	{
		country_code: 'RO',
		category: 'reduced',
		rate: 9,
		valid_from: '2017-01-01',
	},
	{
		country_code: 'RO',
		category: 'standard',
		rate: 21,
		valid_from: '2025-08-01',
	},
	{
		country_code: 'RO',
		category: 'reduced',
		rate: 11,
		valid_from: '2025-08-01',
	},
];

describe('pickRatesInForce', () => {
	it('takes the newest row on or before the day', () => {
		const inForce = pickRatesInForce(romania, '2026-11-15');

		expect(inForce.get('RO|standard')).toBe(21);
		expect(inForce.get('RO|reduced')).toBe(11);
	});

	it('keeps the previous rate until the day a change takes effect', () => {
		expect(pickRatesInForce(romania, '2025-07-31').get('RO|reduced')).toBe(
			9,
		);
		expect(pickRatesInForce(romania, '2025-08-01').get('RO|reduced')).toBe(
			11,
		);
	});

	it('ignores a change entered ahead of time until its day', () => {
		const rows: VatRateRow[] = [
			...romania,
			{
				country_code: 'RO',
				category: 'reduced',
				rate: 13,
				valid_from: '2027-01-01',
			},
		];

		expect(pickRatesInForce(rows, '2026-12-31').get('RO|reduced')).toBe(11);
		expect(pickRatesInForce(rows, '2027-01-01').get('RO|reduced')).toBe(13);
	});

	it('does not depend on row order', () => {
		const reversed = [...romania].reverse();

		expect(
			pickRatesInForce(reversed, '2026-11-15').get('RO|standard'),
		).toBe(21);
	});

	it('keeps countries apart', () => {
		const rows: VatRateRow[] = [
			...romania,
			{
				country_code: 'DE',
				category: 'standard',
				rate: 19,
				valid_from: '2007-01-01',
			},
		];
		const inForce = pickRatesInForce(rows, '2026-11-15');

		expect(inForce.get('DE|standard')).toBe(19);
		expect(inForce.get('RO|standard')).toBe(21);
	});
});

describe('rateFor', () => {
	const day = '2026-11-15';
	const inForce = pickRatesInForce(romania, day);

	it('resolves a rated class to its row', () => {
		expect(rateFor(inForce, 'RO', VatCategoryEnum.REDUCED, day)).toBe(11);
	});

	it('answers zero and exempt with 0 without a row', () => {
		expect(rateFor(inForce, 'RO', VatCategoryEnum.ZERO, day)).toBe(0);
		expect(rateFor(new Map(), 'XX', VatCategoryEnum.EXEMPT, day)).toBe(0);
	});

	it('falls back to standard for a rated class the country has no row for', () => {
		expect(
			rateFor(inForce, 'RO', VatCategoryEnum.SECOND_REDUCED, day),
		).toBe(21);
	});

	it('refuses with 409 when the country has no standard rate in force', () => {
		const call = () =>
			rateFor(inForce, 'DE', VatCategoryEnum.STANDARD, day);

		expect(call).toThrow(CustomError);

		try {
			call();
		} catch (error) {
			expect((error as CustomError).statusCode).toBe(409);
		}
	});

	it('refuses before the first row of a country takes effect', () => {
		const early = pickRatesInForce(romania, '2016-12-31');

		expect(() =>
			rateFor(early, 'RO', VatCategoryEnum.STANDARD, '2016-12-31'),
		).toThrow(CustomError);
	});
});

describe('toVatDay', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('reads the day in company time, so a change applies at local midnight', () => {
		const get = Configuration.get;

		jest.spyOn(Configuration, 'get').mockImplementation(((key: string) =>
			key === 'app.timezone'
				? 'Europe/Bucharest'
				: get(key as never)) as typeof Configuration.get);

		// 22:30 UTC on 31 July is 01:30 on 1 August in Bucharest (UTC+3 in summer)
		expect(toVatDay(new Date('2025-07-31T22:30:00Z'))).toBe('2025-08-01');
		expect(toVatDay(new Date('2025-07-31T20:59:00Z'))).toBe('2025-07-31');
	});
});
