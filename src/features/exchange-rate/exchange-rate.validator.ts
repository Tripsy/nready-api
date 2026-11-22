import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { ExchangeRateSourceEnum } from '@/features/exchange-rate/exchange-rate.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import {
	CURRENCY_CODE_CHARS,
	CURRENCY_CODE_PATTERN,
	normalizeCurrency,
} from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * The currency and the day it belongs to are absent on purpose: together they are the row's
 * identity, and moving one of them would rewrite a rate that documents were already priced
 * against. A wrong currency or a wrong day is deleted and entered again.
 */
export const paramsUpdateList: string[] = ['rate', 'notes'];

export const OrderByEnum = {
	ID: 'id',
	RATE_DATE: 'rate_date',
	CURRENCY: 'currency',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_currency',
	'invalid_base_currency',
	'invalid_rate',
	'invalid_rate_date',
	'invalid_rate_date_format',
	'rate_date_in_the_future',
	'invalid_source',
	'invalid_provider',
] as const;

/** `rate` is `decimal(14, 8)`; anything finer would be rounded away by the column. */
const RATE_DECIMALS = 8;

const PROVIDER_MAX_CHARS = 50;

/**
 * `base_currency` is accepted in no write schema - the service fills it from `app.currency`,
 * because a rate the dashboard enters is always against the books the deployment keeps. It stays
 * a filter on `find`, where a table holding rows imported before a currency switch still has to
 * be searchable by what they were quoted in.
 *
 * `source` and `provider` are likewise not writable: everything entered here is a human's figure
 * and the service stores it as `manual`. Letting a request name a provider would let a hand-typed
 * rate claim to have come from a feed.
 */
export class ExchangeRateValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly create = z.object({
		currency: this.currencyCode(this.getMessage('invalid_currency')),
		rate: this.validateNumber(this.getMessage('invalid_rate'), {
			allowDecimals: RATE_DECIMALS,
		}),
		/*
		 * `maxFutureSeconds: 0` rejects any day after today while leaving today itself valid -
		 * a rate is published for a day that has begun, never announced ahead.
		 */
		rate_date: this.validateDate(
			{
				invalid_date: this.getMessage('invalid_rate_date'),
				invalid_date_format: this.getMessage(
					'invalid_rate_date_format',
				),
				invalid_future_date: this.getMessage('rate_date_in_the_future'),
			},
			{ maxFutureSeconds: 0 },
		),
		notes: this.validateString(this.getMessage('invalid_notes'), {
			required: false,
		}),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			rate: this.validateNumber(this.getMessage('invalid_rate'), {
				required: false,
				allowDecimals: RATE_DECIMALS,
			}),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.RATE_DATE,

		directionEnum: OrderDirectionEnum,
		// Newest first: the rates worth looking at are the ones just published
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' }), {
				required: false,
			}),
			currency: this.optionalCurrencyCode(
				this.getMessage('invalid_currency'),
			),
			base_currency: this.optionalCurrencyCode(
				this.getMessage('invalid_base_currency'),
			),
			source: this.validateEnum(
				ExchangeRateSourceEnum,
				this.getMessage('invalid_source'),
				{ required: false },
			),
			provider: this.validateString(this.getMessage('invalid_provider'), {
				required: false,
				maxChars: PROVIDER_MAX_CHARS,
			}),
			rate_date_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_rate_date'),
					invalid_date_format: this.getMessage(
						'invalid_rate_date_format',
					),
				},
				{ required: false },
			),
			rate_date_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_rate_date'),
					invalid_date_format: this.getMessage(
						'invalid_rate_date_format',
					),
				},
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
		},
	});

	/**
	 * Uppercased before the pattern runs, so `eur` is accepted and stored the single way every
	 * row uses. The column is `char(3)` and Postgres does not fold case, so a lowercase row
	 * would sit unmatched beside its uppercase twin - and the unique index would not see the
	 * two as the same currency.
	 */
	private currencyCode(message: string) {
		return this.validateString(message, {
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		})
			.transform(normalizeCurrency)
			.refine((value) => CURRENCY_CODE_PATTERN.test(value), { message });
	}

	private optionalCurrencyCode(message: string) {
		return this.validateString(message, {
			required: false,
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		})
			.transform((value) =>
				value === undefined ? value : normalizeCurrency(value),
			)
			.refine(
				(value) =>
					value === undefined || CURRENCY_CODE_PATTERN.test(value),
				{ message },
			);
	}
}
