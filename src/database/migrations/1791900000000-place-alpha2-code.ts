import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives a country place its ISO 3166-1 alpha-2 code, beside the alpha-3 `code` it already carries.
 *
 * Two columns rather than one because they answer different questions. `code` identifies a row
 * across seed runs and is what links a child to its parent (`parent_code`), so it cannot be
 * rewritten without risking duplicate rows. `alpha2_code` is the vocabulary every country *rule*
 * speaks: `discount.conditions.applicable_countries` and
 * `article_visibility_rule.allowed_countries`. The latter is compared against CDN geo headers
 * (`cf-ipcountry` and friends), which emit alpha-2 and are not ours to change - so alpha-2 is the
 * standard the rest of the system meets.
 *
 * Nullable, and meaningful on countries alone: a region or a city has no ISO country code of its
 * own. The backfill covers the countries the place seed ships; a country added since is left null
 * and fails every country condition closed until somebody fills it in, which is the safe direction
 * for a rule that governs access and money.
 */
export class PlaceAlpha2Code1791900000000 implements MigrationInterface {
	name = 'PlaceAlpha2Code1791900000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "place" ADD "alpha2_code" character varying(2)`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "place"."alpha2_code" IS 'ISO 3166-1 alpha-2, countries only; the vocabulary country rules are matched against'`,
		);

		/*
		 * Backfilled here rather than by the seed: the place seed tops up by `code` and skips any
		 * row already stored, so a re-run would never reach a country that exists.
		 */
		await queryRunner.query(
			`UPDATE "place"
			    SET "alpha2_code" = CASE "code"
			        WHEN 'ROU' THEN 'RO'
			        WHEN 'HUN' THEN 'HU'
			        WHEN 'BGR' THEN 'BG'
			        WHEN 'AUT' THEN 'AT'
			        WHEN 'DEU' THEN 'DE'
			        WHEN 'ITA' THEN 'IT'
			    END
			  WHERE "place_type" = 'country'
			    AND "code" IN ('ROU', 'HUN', 'BGR', 'AUT', 'DEU', 'ITA')`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "place" DROP COLUMN "alpha2_code"`,
		);
	}
}
