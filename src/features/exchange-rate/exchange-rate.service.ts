import type { DeepPartial } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import ExchangeRateEntity, {
	ExchangeRateSourceEnum,
	resolveBaseCurrency,
} from '@/features/exchange-rate/exchange-rate.entity';
import { getExchangeRateRepository } from '@/features/exchange-rate/exchange-rate.repository';
import {
	type ExchangeRateValidator,
	paramsUpdateList,
} from '@/features/exchange-rate/exchange-rate.validator';
import {
	createCurrentDate,
	dateDiff,
	formatDate,
	stringToDate,
} from '@/helpers/date.helper';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * How far back a stored rate stays editable. Rates are corrected while the period they belong
 * to is still open; past that, documents have been issued against them and reporting has been
 * read, so a silent change to an old rate would move figures nobody is looking at any more.
 */
export const UPDATE_WINDOW_DAYS = 7;

const SECONDS_PER_DAY = 86400;

/**
 * `formatDate` is nullable for the general case. `rate_date` arrives as a `Date` the validator
 * has already accepted, so `strict` turns the impossible null into a throw instead of a
 * narrowing every caller would have to repeat.
 */
const toRateDate = (value: Date): string =>
	formatDate(value, 'default', { strict: true }) as string;

/** One line of a feed's publication, already reduced to a rate for a single unit. */
export type ImportedRate = {
	currency: string;
	base_currency: string;
	rate: number;
};

export type ImportSummary = {
	inserted: number;
	updated: number;
	/** Already stored with the same rate - the ordinary result of re-reading a bulletin. */
	unchanged: number;
	/** Left alone because a person had corrected that row. */
	skipped_manual: number;
};

const pairKey = (rate: Pick<ImportedRate, 'currency' | 'base_currency'>) =>
	`${rate.currency}|${rate.base_currency}`;

export class ExchangeRateService {
	constructor(
		private repository: ReturnType<typeof getExchangeRateRepository>,
	) {}

	/**
	 * @description Used in `create` method from controller;
	 *
	 * One rate per pair per day, enforced by a unique index. The lookup is what produces a
	 * message the caller can act on; the catch below covers the insert that loses a race with
	 * a concurrent one, where the index is the only thing left to stop it. Without either, a
	 * duplicate surfaces as a driver error - a 500 whose message the error handler masks.
	 */
	public async create(
		data: ValidatorOutput<ExchangeRateValidator, 'create'>,
	): Promise<ExchangeRateEntity> {
		const rateDate = toRateDate(data.rate_date);
		const baseCurrency = resolveBaseCurrency();

		if (data.currency === baseCurrency) {
			throw new BadRequestError(
				lang('exchange-rate.error.same_currency', {
					currency: baseCurrency,
				}),
			);
		}

		const existing = await this.repository
			.createQuery()
			.filterByCurrency(data.currency, baseCurrency)
			.filterBy('rate_date', rateDate)
			.first();

		if (existing) {
			throw this.alreadyExistsError(
				data.currency,
				baseCurrency,
				rateDate,
			);
		}

		try {
			return await this.repository.save({
				currency: data.currency,
				base_currency: baseCurrency,
				rate: data.rate,
				rate_date: rateDate,
				// Everything written through the API is a human's entry, whatever an earlier
				// import had put there - see `updateData`
				source: ExchangeRateSourceEnum.MANUAL,
				provider: null,
				notes: data.notes ?? null,
			});
		} catch (error) {
			if (RepositoryAbstract.isUniqueViolation(error)) {
				throw this.alreadyExistsError(
					data.currency,
					baseCurrency,
					rateDate,
				);
			}

			throw error;
		}
	}

	private alreadyExistsError(
		currency: string,
		baseCurrency: string,
		rateDate: string,
	): CustomError {
		return new CustomError(
			409,
			lang('exchange-rate.error.already_exists', {
				currency,
				base_currency: baseCurrency,
				rate_date: rateDate,
			}),
		);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ExchangeRateEntity> & { id: EntityId },
	): Promise<ExchangeRateEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ExchangeRateEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 *
	 * The row's source becomes `manual` whatever it was: a corrected rate is a human's figure,
	 * and an import must not put its own back over it on the next run.
	 */
	public async updateData(
		entry: ExchangeRateEntity,
		data: ValidatorOutput<ExchangeRateValidator, 'update'>,
	): Promise<ExchangeRateEntity> {
		this.assertWithinUpdateWindow(entry);

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		entry.source = ExchangeRateSourceEnum.MANUAL;
		entry.provider = null;

		return this.update(entry);
	}

	/**
	 * The window is measured from the day the rate applies to, not from when the row was
	 * written: a rate backfilled today for a date three weeks ago is already outside it, which
	 * is the point - what it would change has been reported on.
	 */
	private assertWithinUpdateWindow(entry: ExchangeRateEntity): void {
		const elapsedSeconds = dateDiff(
			stringToDate(entry.rate_date, true),
			createCurrentDate(true),
			'seconds',
		);

		if (elapsedSeconds > UPDATE_WINDOW_DAYS * SECONDS_PER_DAY) {
			throw new BadRequestError(
				lang('exchange-rate.error.update_window_expired', {
					days: String(UPDATE_WINDOW_DAYS),
					rate_date: entry.rate_date,
				}),
			);
		}
	}

	/**
	 * Hard delete: the table has no `deleted_at`. A soft-deleted row would keep its
	 * (pair, day) key occupied while every query filters it out, so the same day could never
	 * be entered again.
	 */
	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete(false);
	}

	public findById(id: EntityId): Promise<ExchangeRateEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/**
	 * @description Store one publication of a feed, one row per pair. Used by the import cron.
	 *
	 * `rateDate` is the bulletin's own day, taken as published: a publisher's date is
	 * authoritative, and a deployment whose clock sits a timezone behind it must not reject a
	 * bulletin for being "tomorrow". The dashboard's no-future-date rule is about what a person
	 * types, and does not apply here.
	 *
	 * A stored row is only ever replaced by a later import if it *came from* an import. A rate
	 * someone corrected by hand is left exactly as it is and counted in `skipped_manual` -
	 * without that, tonight's run would quietly undo this morning's correction.
	 */
	public async importRates(
		rateDate: string,
		rates: ReadonlyArray<ImportedRate>,
		provider: string,
	): Promise<ImportSummary> {
		const summary: ImportSummary = {
			inserted: 0,
			updated: 0,
			unchanged: 0,
			skipped_manual: 0,
		};

		if (rates.length === 0) {
			return summary;
		}

		const touchedIds = await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(ExchangeRateEntity);

			// One read for the whole bulletin: a day holds a handful of pairs, and asking per
			// row would be a query each. Inside the transaction, so the decision to update or
			// insert is made against rows no concurrent run can move underneath it
			const stored = await repository.find({
				where: { rate_date: rateDate },
			});

			const storedByPair = new Map(
				stored.map((entry) => [pairKey(entry), entry]),
			);

			const updatedIds: EntityId[] = [];

			for (const rate of rates) {
				const existing = storedByPair.get(pairKey(rate));

				if (!existing) {
					await repository.save({
						currency: rate.currency,
						base_currency: rate.base_currency,
						rate: rate.rate,
						rate_date: rateDate,
						source: ExchangeRateSourceEnum.IMPORT,
						provider,
						notes: null,
					});

					summary.inserted++;
					continue;
				}

				if (existing.source === ExchangeRateSourceEnum.MANUAL) {
					summary.skipped_manual++;
					continue;
				}

				if (existing.rate === rate.rate) {
					summary.unchanged++;
					continue;
				}

				existing.rate = rate.rate;
				existing.provider = provider;

				await repository.save(existing);

				updatedIds.push(existing.id);
				summary.updated++;
			}

			return updatedIds;
		});

		// After the commit, never inside it: a reader that refills the cache between the clean
		// and the COMMIT would leave it holding the superseded rate with nothing to correct it.
		// Inserts need no clean - a new row has no cached key
		await cleanEntityCacheMany(ExchangeRateEntity, touchedIds);

		return summary;
	}

	/**
	 * @description What one unit of `currency` was worth on `date` - the newest publication on
	 * or before it, so a weekend or a holiday carries the previous working day forward.
	 *
	 * Multiply an amount in `currency` by the answer to reach `baseCurrency`, which defaults to
	 * the deployment's own. The base currency itself is 1 without a query.
	 *
	 * Returns `null` when the currency has never been published, which the caller has to answer
	 * for: converting at a made-up rate is worse than refusing. The reverse direction is not
	 * tried - a caller wanting it takes the reciprocal, rather than having this quietly invert a
	 * rate that was published the other way round.
	 */
	public async getRateAsOf(
		currency: string,
		date: Date = createCurrentDate(true),
		baseCurrency: string = resolveBaseCurrency(),
	): Promise<number | null> {
		if (currency === baseCurrency) {
			return 1;
		}

		const entry = await this.repository
			.createQuery()
			.select(['exchange_rate.rate'])
			.filterByCurrency(currency, baseCurrency)
			.filterAsOf(toRateDate(date))
			.orderBy('rate_date', OrderDirectionEnum.DESC)
			.first();

		return entry?.rate ?? null;
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: { id: EntityId }) {
		return await this.repository
			.createQuery()
			.select(SELECT_COLUMNS)
			.filterById(data.id)
			.firstOrFail();
	}

	public findByFilter(data: ValidatorOutput<ExchangeRateValidator, 'find'>) {
		return this.repository
			.createQuery()
			.select(SELECT_COLUMNS)
			.filterById(data.filter.id)
			.filterByCurrency(data.filter.currency, data.filter.base_currency)
			.filterBy('source', data.filter.source)
			.filterBy('provider', data.filter.provider)
			.filterByRange(
				'rate_date',
				data.filter.rate_date_start,
				data.filter.rate_date_end,
			)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

const SELECT_COLUMNS = [
	'exchange_rate.id',
	'exchange_rate.currency',
	'exchange_rate.base_currency',
	'exchange_rate.rate',
	'exchange_rate.rate_date',
	'exchange_rate.source',
	'exchange_rate.provider',
	'exchange_rate.notes',
	'exchange_rate.created_at',
	'exchange_rate.updated_at',
];

export const exchangeRateService = new ExchangeRateService(
	getExchangeRateRepository(),
);
