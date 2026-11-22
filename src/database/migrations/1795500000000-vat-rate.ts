import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `vat_rate`: the percentage each rated VAT class carries per country, from the day it applies.
 * Replaces the `VAT_RATE_*` environment variables, so a rate change is a row rather than a
 * redeploy, and a business in another country can be priced at its own rates.
 *
 * The Romanian history is inserted here rather than by a seed: pricing refuses a country with no
 * `standard` rate in force, so every environment needs these rows the moment the code that reads
 * them runs.
 *
 * - From 2017-01-01 (Fiscal Code, Law 227/2015): 19% standard, 9% and 5% reduced.
 * - From 2025-08-01 (Law 141/2025): 21% standard, 11% reduced. The 5% class is folded into 11%
 *   in general; its transitional uses (housing) are not modeled - the catalog sells nothing
 *   that falls under them.
 */
export class VatRate1795500000000 implements MigrationInterface {
	name = 'VatRate1795500000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "vat_rate" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "country_code" character(2) NOT NULL, "category" character varying(32) NOT NULL, "rate" numeric(5,2) NOT NULL, "valid_from" date NOT NULL, "notes" text, CONSTRAINT "CHK_697cd476439589d54e51808d35" CHECK ((category IN ('standard', 'reduced', 'second_reduced'))), CONSTRAINT "CHK_e7debdbe1dc0d0dac35b3ed28f" CHECK ((rate >= 0 AND rate < 100)), CONSTRAINT "PK_e7a4f4bdee032b0c3e3f6450510" PRIMARY KEY ("id")); COMMENT ON COLUMN "vat_rate"."country_code" IS 'ISO 3166-1 alpha-2 of the jurisdiction'; COMMENT ON COLUMN "vat_rate"."category" IS 'VAT class key; see RatedVatCategoryEnum'; COMMENT ON COLUMN "vat_rate"."rate" IS 'Percentage, e.g. 21.00'; COMMENT ON COLUMN "vat_rate"."valid_from" IS 'First day the rate applies'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_vat_rate_unique" ON "vat_rate"  ("country_code", "category", "valid_from") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "vat_rate" IS 'VAT percentage per country and VAT class, from the day it applies'`,
		);
		await queryRunner.query(
			`INSERT INTO "vat_rate" ("country_code", "category", "rate", "valid_from", "notes") VALUES
				('RO', 'standard', 19, '2017-01-01', 'Fiscal Code, Law 227/2015'),
				('RO', 'reduced', 9, '2017-01-01', 'Fiscal Code, Law 227/2015 - food and restaurant service'),
				('RO', 'second_reduced', 5, '2017-01-01', 'Fiscal Code, Law 227/2015'),
				('RO', 'standard', 21, '2025-08-01', 'Law 141/2025 - alcohol, NC 2202 sweetened drinks'),
				('RO', 'reduced', 11, '2025-08-01', 'Law 141/2025 - food and non-alcoholic restaurant service'),
				('RO', 'second_reduced', 11, '2025-08-01', 'Law 141/2025 - the 5% class folds into 11%')`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."IDX_vat_rate_unique"`);
		await queryRunner.query(`DROP TABLE "vat_rate"`);
	}
}
