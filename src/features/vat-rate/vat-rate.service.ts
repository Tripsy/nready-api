import type { DeepPartial } from 'typeorm';
import dayjs from '@/config/dayjs.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { CustomError } from '@/exceptions';
import VatRateEntity, {
	type RatedVatCategory,
	RatedVatCategoryEnum,
	type VatCategory,
} from '@/features/vat-rate/vat-rate.entity';
import { getVatRateRepository } from '@/features/vat-rate/vat-rate.repository';
import {
	paramsUpdateList,
	type VatRateValidator,
} from '@/features/vat-rate/vat-rate.validator';
import { formatDate } from '@/helpers/date.helper';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/** The percentage one VAT class carries in the country and on the day the resolver was built for. */
export type VatResolver = (category: VatCategory) => number;

export type VatRateRow = Pick<
	VatRateEntity,
	'country_code' | 'category' | 'rate' | 'valid_from'
>;

const RATED_CATEGORIES: ReadonlySet<string> = new Set(
	Object.values(RatedVatCategoryEnum),
);

/**
 * The calendar day `at` falls on in company time (`app.timezone`). A rate change takes effect at
 * local midnight, and the container clock runs in UTC, so 23:30 UTC on 31 July is already 1 August
 * in Bucharest and has to be priced at August's rate.
 */
export const toVatDay = (at: Date): string =>
	dayjs(at).tz(Configuration.get('app.timezone')).format('YYYY-MM-DD');

/**
 * The rate each (country, category) carries on `day`: the row with the newest `valid_from` on
 * or before it. Rows dated after `day` are ignored, so a change entered ahead of time takes over
 * on its own. Pure, so the selection is testable without a database.
 *
 * Keys are `<country>|<category>`.
 */
export function pickRatesInForce(
	rows: readonly VatRateRow[],
	day: string,
): Map<string, number> {
	const newest = new Map<string, VatRateRow>();

	for (const row of rows) {
		if (row.valid_from > day) {
			continue;
		}

		const key = `${row.country_code}|${row.category}`;
		const current = newest.get(key);

		if (!current || row.valid_from > current.valid_from) {
			newest.set(key, row);
		}
	}

	return new Map(
		[...newest.entries()].map(([key, row]) => [key, Number(row.rate)]),
	);
}

/**
 * Turns a VAT class into a percentage for `countryCode`, from the rates `pickRatesInForce`
 * selected.
 *
 * - `zero` and `exempt` are 0 everywhere and never looked up.
 * - A rated class the country has no row for falls back to the country's `standard` rate:
 *   under-charging VAT is the error that costs money, and a class the jurisdiction does not use
 *   is safest taxed at the full rate until someone enters it.
 * - A country with no `standard` rate in force is a deployment that has not been set up for that
 *   jurisdiction. That refuses with a 409 naming the country, rather than pricing at a guessed
 *   rate - thrown when a rated class is first asked about, so a page that prices nothing taxable
 *   still renders.
 */
export function rateFor(
	inForce: ReadonlyMap<string, number>,
	countryCode: string,
	category: VatCategory,
	day: string,
): number {
	if (!RATED_CATEGORIES.has(category)) {
		return 0;
	}

	const rate =
		inForce.get(`${countryCode}|${category}`) ??
		inForce.get(`${countryCode}|${RatedVatCategoryEnum.STANDARD}`);

	if (rate === undefined) {
		throw new CustomError(
			409,
			lang('vat-rate.error.not_configured', {
				country_code: countryCode,
				day: day,
			}),
		);
	}

	return rate;
}

export class VatRateService {
	constructor(private repository: ReturnType<typeof getVatRateRepository>) {}

	/**
	 * @description Used in `create` method from controller;
	 *
	 * One row per country, category and day, enforced by a unique index. The lookup is what
	 * produces a message the caller can act on; the catch covers an insert that loses a race with
	 * a concurrent one, where the index is all that is left to stop it.
	 */
	public async create(
		data: ValidatorOutput<VatRateValidator, 'create'>,
	): Promise<VatRateEntity> {
		const validFrom = formatDate(data.valid_from, 'default', {
			strict: true,
		}) as string;

		const existing = await this.repository
			.createQuery()
			.filterBy('country_code', data.country_code)
			.filterBy('category', data.category)
			.filterBy('valid_from', validFrom)
			.first();

		if (existing) {
			throw this.alreadyExistsError(
				data.country_code,
				data.category,
				validFrom,
			);
		}

		try {
			return await this.repository.save({
				country_code: data.country_code,
				category: data.category,
				rate: data.rate,
				valid_from: validFrom,
				notes: data.notes ?? null,
			});
		} catch (error) {
			if (RepositoryAbstract.isUniqueViolation(error)) {
				throw this.alreadyExistsError(
					data.country_code,
					data.category,
					validFrom,
				);
			}

			throw error;
		}
	}

	private alreadyExistsError(
		countryCode: string,
		category: RatedVatCategory,
		validFrom: string,
	): CustomError {
		return new CustomError(
			409,
			lang('vat-rate.error.already_exists', {
				country_code: countryCode,
				category: category,
				valid_from: validFrom,
			}),
		);
	}

	/**
	 * @description Update any data
	 *
	 * Editable at any time, unlike an exchange rate: every document freezes the figure it was
	 * priced at, so a correction reaches carts and catalog quotes and nothing already written.
	 */
	public async update(
		data: DeepPartial<VatRateEntity> & { id: number },
	): Promise<VatRateEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(VatRateEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: VatRateEntity,
		data: ValidatorOutput<VatRateValidator, 'update'>,
	): Promise<VatRateEntity> {
		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	/**
	 * Hard delete: the table has no `deleted_at`, for the reason the entity gives. Removing a row
	 * hands its period back to the row before it.
	 */
	public async delete(id: number) {
		// `RepositoryAbstract.delete` cleans the cached read of every row it removes
		await this.repository.createQuery().filterById(id).delete(false);
	}

	public findById(id: number): Promise<VatRateEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/**
	 * @description Resolves VAT classes as of `at` - the one entry point pricing goes through.
	 *
	 * Async once, sync after: one indexed read of the country's rows in force by that day, and
	 * the returned function answers from memory, so the pricing code that calls it per line stays
	 * synchronous and costs no query per line.
	 *
	 * The jurisdiction is the deployment's `company.addressCountry`; `countryCode` overrides it
	 * for a caller that prices for another one.
	 */
	public async resolverFor(
		at: Date = new Date(),
		countryCode: string = Configuration.get('company.addressCountry'),
	): Promise<VatResolver> {
		const day = toVatDay(at);
		const country = countryCode.trim().toUpperCase();

		const rows = await this.repository
			.createQuery()
			.select([
				'vat_rate.country_code',
				'vat_rate.category',
				'vat_rate.rate',
				'vat_rate.valid_from',
			])
			.filterBy('country_code', country)
			.filterInForceBy(day)
			.all();

		const inForce = pickRatesInForce(rows, day);

		return (category) => rateFor(inForce, country, category, day);
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: { id: number }) {
		return await this.repository
			.createQuery()
			.select(SELECT_COLUMNS)
			.filterById(data.id)
			.firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<VatRateValidator, 'find'>) {
		return this.repository
			.createQuery()
			.select(SELECT_COLUMNS)
			.filterById(data.filter.id)
			.filterBy('country_code', data.filter.country_code)
			.filterBy('category', data.filter.category)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.orderBy('category', OrderDirectionEnum.ASC)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

const SELECT_COLUMNS = [
	'vat_rate.id',
	'vat_rate.country_code',
	'vat_rate.category',
	'vat_rate.rate',
	'vat_rate.valid_from',
	'vat_rate.notes',
	'vat_rate.created_at',
	'vat_rate.updated_at',
];

export const vatRateService = new VatRateService(getVatRateRepository());
