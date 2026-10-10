import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The client ledger becomes the money that moved with a client: one entry per completed cash flow
 * filed under them, and nothing for documents.
 *
 * - The `invoice` and `reversal` entries go - what a client was charged is read from the invoices
 *   themselves - and with them `invoice_id`, its key and its index.
 * - The remaining entries flip sign to the business's view of its cash: a payment received is
 *   positive, a refund paid back negative, so the sum is the net money received.
 * - `cash_flow_id` becomes required and unique - one entry per movement.
 * - The entry type enum keeps `payment` and `refund` only.
 *
 * `down` restores the shape, not the document entries - those were derived from the invoices, and
 * reconcile before this change could write them again.
 */
export class ClientLedgerCashOnly1793700000000 implements MigrationInterface {
	name = 'ClientLedgerCashOnly1793700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "CHK_e267995432daf0af1afbacd1a6"`,
		);

		await queryRunner.query(
			`DELETE FROM "client_ledger" WHERE "entry_type" IN ('invoice', 'reversal')`,
		);
		await queryRunner.query(
			`UPDATE "client_ledger" SET "amount" = -"amount", "amount_base" = -"amount_base"`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_ledger_invoice"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "FK_40b5662709dad4ee2338968bf3d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP COLUMN "invoice_id"`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_ledger_cash_flow"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_ledger_cash_flow_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ALTER COLUMN "cash_flow_id" SET NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_ledger_cash_flow" ON "client_ledger" ("cash_flow_id")`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."client_ledger_entry_type_enum_new" AS ENUM('payment', 'refund')`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ALTER COLUMN "entry_type" TYPE "public"."client_ledger_entry_type_enum_new" USING "entry_type"::text::"public"."client_ledger_entry_type_enum_new"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."client_ledger_entry_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."client_ledger_entry_type_enum_new" RENAME TO "client_ledger_entry_type_enum"`,
		);

		await queryRunner.query(
			`COMMENT ON TABLE "client_ledger" IS 'Append-only record of the money moved with each client, per currency'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_ledger"."currency" IS 'Currency of the movement'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_ledger"."amount" IS 'Positive: money received from the client; negative: money paid back'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_ledger"."exchange_rate" IS 'Rate to the deployment base currency, frozen from the movement'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_ledger"."occurred_at" IS 'When the money moved'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."client_ledger_entry_type_enum_old" AS ENUM('invoice', 'reversal', 'payment', 'refund')`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ALTER COLUMN "entry_type" TYPE "public"."client_ledger_entry_type_enum_old" USING "entry_type"::text::"public"."client_ledger_entry_type_enum_old"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."client_ledger_entry_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."client_ledger_entry_type_enum_old" RENAME TO "client_ledger_entry_type_enum"`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_ledger_cash_flow"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ALTER COLUMN "cash_flow_id" DROP NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_ledger_cash_flow_id" ON "client_ledger" ("cash_flow_id") WHERE cash_flow_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_ledger_cash_flow" ON "client_ledger" ("entry_type", "cash_flow_id") WHERE cash_flow_id IS NOT NULL`,
		);

		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD "invoice_id" integer`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "FK_40b5662709dad4ee2338968bf3d" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_ledger_invoice" ON "client_ledger" ("entry_type", "invoice_id") WHERE invoice_id IS NOT NULL`,
		);

		await queryRunner.query(
			`UPDATE "client_ledger" SET "amount" = -"amount", "amount_base" = -"amount_base"`,
		);

		await queryRunner.query(`ALTER TABLE "client_ledger" ADD CONSTRAINT "CHK_e267995432daf0af1afbacd1a6" CHECK (
	(
		(entry_type IN ('invoice', 'reversal') AND invoice_id IS NOT NULL AND cash_flow_id IS NULL)
		OR (entry_type IN ('payment', 'refund') AND cash_flow_id IS NOT NULL AND invoice_id IS NULL)
	)
)`);
	}
}
