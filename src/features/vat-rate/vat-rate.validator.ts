import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	COUNTRY_CODE_CHARS,
	COUNTRY_CODE_PATTERN,
	RatedVatCategoryEnum,
} from '@/features/vat-rate/vat-rate.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * The country, the category and the day are absent on purpose: together they are the row's
 * identity. A row entered for the wrong one is deleted and entered again, so an edit can never
 * move a rate onto another jurisdiction or another period.
 */
export const paramsUpdateList: string[] = ['rate', 'notes'];

export const OrderByEnum = {
	ID: 'id',
	COUNTRY_CODE: 'country_code',
	VALID_FROM: 'valid_from',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_country_code',
	'invalid_category',
	'invalid_rate',
	'invalid_valid_from',
	'invalid_valid_from_format',
] as const;

/** `rate` is `decimal(5, 2)`, the scale `order_line.vat_rate` freezes it at. */
const RATE_DECIMALS = 2;

/**
 * `valid_from` takes any day, past or future. A future day is the ordinary case - a rate change
 * is entered once the law is published and takes over on its own at midnight - and a past day is
 * how history is backfilled. Neither moves a document already written, which carries its own copy.
 */
export class VatRateValidator extends BaseValidator<typeof validatorMessages> {
	readonly create = z.object({
		country_code: this.countryCode(),
		category: this.validateEnum(
			RatedVatCategoryEnum,
			this.getMessage('invalid_category'),
		),
		rate: this.rate(),
		valid_from: this.validFrom(),
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
			rate: this.rate(false),
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
		defaultOrderBy: OrderByEnum.VALID_FROM,

		directionEnum: OrderDirectionEnum,
		// Newest first: the rows worth looking at are the ones in force or about to be
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			country_code: this.optionalCountryCode(),
			category: this.validateEnum(
				RatedVatCategoryEnum,
				this.getMessage('invalid_category'),
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
		},
	});

	/**
	 * Uppercased before the pattern runs, so `ro` is accepted and stored the one way every row
	 * uses - the column is `char(2)` and the unique index would not see `ro` and `RO` as one.
	 */
	private countryCode() {
		const message = this.getMessage('invalid_country_code');

		return this.validateString(message, {
			minChars: COUNTRY_CODE_CHARS,
			maxChars: COUNTRY_CODE_CHARS,
		})
			.transform((value) => value.trim().toUpperCase())
			.refine((value) => COUNTRY_CODE_PATTERN.test(value), { message });
	}

	private optionalCountryCode() {
		const message = this.getMessage('invalid_country_code');

		return this.validateString(message, {
			required: false,
			minChars: COUNTRY_CODE_CHARS,
			maxChars: COUNTRY_CODE_CHARS,
		})
			.transform((value) =>
				value === undefined ? value : value.trim().toUpperCase(),
			)
			.refine(
				(value) =>
					value === undefined || COUNTRY_CODE_PATTERN.test(value),
				{ message },
			);
	}

	/** 0 is a legal rate for a rated class; 100 or more is a typo the column check would refuse. */
	private rate(required = true) {
		const message = this.getMessage('invalid_rate');

		const base = required
			? this.validateNumber(message, {
					onlyPositive: false,
					allowDecimals: RATE_DECIMALS,
				})
			: this.validateNumber(message, {
					required: false,
					onlyPositive: false,
					allowDecimals: RATE_DECIMALS,
				});

		return base.refine(
			(value) => value === undefined || (value >= 0 && value < 100),
			{ message },
		);
	}

	private validFrom() {
		return this.validateDate({
			invalid_date: this.getMessage('invalid_valid_from'),
			invalid_date_format: this.getMessage('invalid_valid_from_format'),
		});
	}
}
