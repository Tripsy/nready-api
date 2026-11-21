import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	UpdateDateColumn,
} from 'typeorm';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

/**
 * The VAT classes a product can declare. A product names a class, never a percentage: the
 * percentage is a function of jurisdiction and date, and is looked up in `vat_rate` when a line is
 * priced (`VatRateService.resolverFor`).
 *
 * Declared here rather than in `product` because this feature reads it to validate and resolve
 * rows, and `product` depends on this feature - the other way round would be an import cycle.
 * `product.entity.ts` re-exports it as `ProductVatCategoryEnum`.
 */
export const VatCategoryEnum = {
	STANDARD: 'standard',
	REDUCED: 'reduced',
	SECOND_REDUCED: 'second_reduced',
	ZERO: 'zero',
	EXEMPT: 'exempt',
} as const;

export type VatCategory =
	(typeof VatCategoryEnum)[keyof typeof VatCategoryEnum];

/**
 * The classes that carry a percentage and therefore have rows in `vat_rate`.
 *
 * `zero` and `exempt` resolve to 0 in every jurisdiction - zero-rated supplies are taxed at 0%
 * and exempt ones carry no VAT - so they are answered without a lookup and cannot be stored. A
 * stored row for them could only ever say 0, or be wrong.
 */
export const RatedVatCategoryEnum = {
	STANDARD: VatCategoryEnum.STANDARD,
	REDUCED: VatCategoryEnum.REDUCED,
	SECOND_REDUCED: VatCategoryEnum.SECOND_REDUCED,
} as const;

export type RatedVatCategory =
	(typeof RatedVatCategoryEnum)[keyof typeof RatedVatCategoryEnum];

/** ISO 3166-1 alpha-2, the vocabulary `company.addressCountry` holds. */
export const COUNTRY_CODE_CHARS = 2;
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

const ENTITY_TABLE_NAME = 'vat_rate';

/**
 * The percentage a VAT class carries in a country from a given day - `RO`, `reduced`, `11`,
 * `2025-08-01`.
 *
 * **A history keyed on the day a rate takes effect, with no end date.** The rate in force on a
 * day is the newest row whose `valid_from` is on or before it, so a rate change is one insert
 * dated the day the law applies, and periods can neither overlap nor leave a gap - the previous
 * row simply stops being the newest. This follows `exchange_rate`.
 *
 * **Keyed by country, priced at one.** A rate is law in a jurisdiction, so rows carry a country;
 * the shop is priced at the deployment's `company.addressCountry`. Rows of other countries are
 * inert until that setting names them.
 *
 * **Never read by a document after it is written.** An order line freezes the figure onto
 * `order_line.vat_rate` and an invoice line onto `invoice_line.vat_rate`, so correcting or
 * removing a row moves carts and catalog quotes, never a document already raised.
 *
 * **No `deleted_at`**, so this does not extend `EntityAbstract`, for the reason `exchange_rate`
 * gives: a soft-deleted row would keep its (country, category, day) key occupied while every
 * query filters it out, and the same day could never be entered again.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'VAT percentage per country and VAT class, from the day it applies',
})
// Also the read path: a lookup fixes the country and scans `valid_from` backwards per category
@Index('IDX_vat_rate_unique', ['country_code', 'category', 'valid_from'], {
	unique: true,
})
@Check(`(rate >= 0 AND rate < 100)`)
@Check(`(category IN ('standard', 'reduced', 'second_reduced'))`)
export default class VatRateEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column('char', {
		length: COUNTRY_CODE_CHARS,
		nullable: false,
		comment: 'ISO 3166-1 alpha-2 of the jurisdiction',
	})
	country_code!: string;

	// `varchar` rather than a Postgres enum, for the reason `product.vat_category` gives
	@Column('varchar', {
		length: 32,
		nullable: false,
		comment: 'VAT class key; see RatedVatCategoryEnum',
	})
	category!: RatedVatCategory;

	// Matches `order_line.vat_rate` / `invoice_line.vat_rate`, the columns this is frozen onto
	@Column('decimal', {
		precision: 5,
		scale: 2,
		nullable: false,
		comment: 'Percentage, e.g. 21.00',
		transformer: numericTransformer,
	})
	rate!: number;

	// A calendar day in the jurisdiction's own time: a rate change takes effect at local midnight
	@Column('date', {
		nullable: false,
		comment: 'First day the rate applies',
	})
	valid_from!: string;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;
}
