import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { Configuration } from '@/config/settings.config';
import {
	CURRENCY_CODE_CHARS,
	CURRENCY_CODE_PATTERN,
	normalizeCurrency,
} from '@/helpers/shop.helper';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

/**
 * Where the row came from, which decides who may overwrite it: an import replaces what a previous
 * import wrote, never what a human corrected by hand.
 */
export const ExchangeRateSourceEnum = {
	MANUAL: 'manual',
	IMPORT: 'import',
} as const;

export type ExchangeRateSource =
	(typeof ExchangeRateSourceEnum)[keyof typeof ExchangeRateSourceEnum];

/**
 * The currency every rate is expressed in: the deployment's own, from `app.currency`.
 *
 * Validated rather than trusted. `APP_CURRENCY` is a free-form env string, and a typo reaching a
 * `char(3)` column would label money wrongly and keep doing it silently - so a broken value fails
 * the write instead, which is a deployment error and reads as one in the log.
 */
export const resolveBaseCurrency = (): string => {
	const configured = normalizeCurrency(Configuration.currency());

	if (!CURRENCY_CODE_PATTERN.test(configured)) {
		throw new Error(
			`APP_CURRENCY must be a 3-letter ISO 4217 code, got "${Configuration.currency()}"`,
		);
	}

	return configured;
};

const ENTITY_TABLE_NAME = 'exchange_rate';

/**
 * What one unit of `currency` was worth in `base_currency` on `rate_date` - `EUR`, `5.2575`,
 * `RON`, meaning 1 EUR = 5.2575 RON.
 *
 * **`base_currency` is the deployment's own currency, not the priced one.** That matches how the
 * word is already used across this codebase - `invoice.base_currency`, and the "rate to the base
 * currency" that `grn`, `cash_flow` and `order_line` freeze onto a document - and it is
 * deliberately the opposite of the FX-market reading of a pair, where the EUR/RON quote calls EUR
 * the base. Rows are stored in the direction a document converts in: multiply an amount in
 * `currency` by `rate` to reach the books.
 *
 * Only that one direction is stored. The reverse is the reciprocal and belongs to whoever needs
 * it - storing both doubles every import and lets the two drift out of agreement.
 *
 * **The table is a history, not a current-rate cache.** A document freezes the rate it was priced
 * at, so what this table has to answer is "the rate as of the day that document was written" -
 * the newest row whose `rate_date` is on or before it. Reading "today's rate" is the same query
 * with today's date, so there is no separate latest-rate row to keep in step.
 *
 * **No `deleted_at`**, so this does not extend `EntityAbstract`, following `document_series`. A
 * soft-deleted row keeps its (currency, base, day) key occupied while every query filters it out,
 * so the next import of that same day would fail on the unique index against a row nobody can
 * see. Removing a rate is a hard delete, and a wrong rate is corrected in place rather than
 * deleted - documents already priced off it keep their own frozen copy.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Published exchange rates per currency and day',
})
// Also the read path: a lookup fixes both currencies and scans `rate_date` backwards for the
// newest row on or before the date asked about, which is this index's trailing column
@Index('IDX_exchange_rate_unique', ['currency', 'base_currency', 'rate_date'], {
	unique: true,
})
@Check(`(rate > 0)`)
@Check(`(currency <> base_currency)`)
// A rate is only attributable when the source that carries a name actually has one
@Check(`
	(source = 'import' AND provider IS NOT NULL)
	OR
	(source = 'manual' AND provider IS NULL)
`)
export default class ExchangeRateEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	// `char(3)` rather than an enum, matching `product_price` / `grn` / `order_line`: an import
	// carries whatever ISO 4217 codes its provider publishes, and a new currency must not need a
	// migration before it can be stored
	@Column('char', {
		length: CURRENCY_CODE_CHARS,
		nullable: false,
		comment: 'ISO 4217 code being priced; the rate is for one unit of it',
	})
	currency!: string;

	@Column('char', {
		length: CURRENCY_CODE_CHARS,
		nullable: false,
		comment: "ISO 4217 code the rate is expressed in; the deployment's own",
	})
	base_currency!: string;

	// Scale 8 carries the pairs a scale of 6 flattens - a unit of a weak currency is worth
	// ~0.00003 of a strong one, which rounds to four significant digits at 6 decimals. The columns
	// that freeze a rate onto a document are `decimal(10, 6)`, so the value narrows on the way
	// out; the wider column here keeps the published figure intact for the conversions that read
	// it directly. 14 digits stays inside what `numericTransformer` can return losslessly
	@Column('decimal', {
		precision: 14,
		scale: 8,
		nullable: false,
		comment: 'Units of `base_currency` per one unit of `currency`',
		transformer: numericTransformer,
	})
	rate!: number;

	// A rate belongs to a calendar day, not an instant: providers publish once per day and a
	// document is converted at the day's rate regardless of the hour it was written
	@Column('date', {
		nullable: false,
		comment: 'Day the rate applies to',
	})
	rate_date!: string;

	@Column({
		type: 'enum',
		enum: ExchangeRateSourceEnum,
		default: ExchangeRateSourceEnum.MANUAL,
		nullable: false,
	})
	source!: ExchangeRateSource;

	@Column('varchar', {
		length: 50,
		nullable: true,
		comment:
			'Name of the feed the rate was imported from; NULL when manual',
	})
	provider!: string | null;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;
}
