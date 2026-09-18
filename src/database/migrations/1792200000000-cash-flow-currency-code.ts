import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns `cash_flow.currency` from a three-value Postgres enum into the validated `char(3)` every
 * other currency column in the schema uses - `invoice`, `order_line`, `shipping`, `product_price`,
 * `exchange_rate`.
 *
 * The ledger has to be able to record the movement that settles a document, and a document may be
 * issued in any ISO code. An enum of RON/EUR/USD makes an invoice raised in a fourth currency
 * unsettleable, which is the coupling `invoice_payment` exists to express. The code is checked on
 * the way in by the validator and `resolveBaseCurrency` instead - see the reasoning on that helper
 * in `exchange-rate.entity.ts`.
 *
 * The column default moves from `EUR` to `RON` to match the other money tables. Rows already
 * stored keep their own value; the default applies only to inserts that name no currency, and the
 * service names one on every create.
 */
export class CashFlowCurrencyCode1792200000000 implements MigrationInterface {
	name = 'CashFlowCurrencyCode1792200000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Dropped before the type change: a default typed as the enum cannot survive it
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ALTER COLUMN "currency" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ALTER COLUMN "currency" TYPE character(3) USING "currency"::text`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ALTER COLUMN "currency" SET DEFAULT 'RON'`,
		);
		await queryRunner.query(`DROP TYPE "public"."cash_flow_currency_enum"`);
	}

	/*
	 * Asymmetric by necessity: the enum holds three codes and the column no longer promises to
	 * stay within them, so a row written in a fourth fails the cast here. That is the honest
	 * outcome - the value cannot round-trip - and it surfaces as a failed revert rather than as
	 * silently relabelled money.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."cash_flow_currency_enum" AS ENUM('RON', 'EUR', 'USD')`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ALTER COLUMN "currency" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ALTER COLUMN "currency" TYPE "public"."cash_flow_currency_enum" USING btrim("currency")::"public"."cash_flow_currency_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ALTER COLUMN "currency" SET DEFAULT 'EUR'`,
		);
	}
}
