import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `invoice_cancel` ledger entry: an issued invoice is no longer canceled - it is taken
 * back by a reversal - so nothing writes it. Postgres cannot drop an enum value, so the type is
 * rebuilt without it, with the check constraint that names it dropped first and replaced after.
 *
 * Refuses to run while any row still holds the value: the rebuild's cast fails on it.
 */
export class ClientLedgerDropInvoiceCancel1793400000000
	implements MigrationInterface
{
	name = 'ClientLedgerDropInvoiceCancel1793400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "CHK_8aa451df0c927056ba4aae12a9"`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."client_ledger_entry_type_enum_new" AS ENUM('invoice', 'reversal', 'payment', 'refund')`,
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

		await queryRunner.query(`ALTER TABLE "client_ledger" ADD CONSTRAINT "CHK_e267995432daf0af1afbacd1a6" CHECK (
	(
		(entry_type IN ('invoice', 'reversal') AND invoice_id IS NOT NULL AND cash_flow_id IS NULL)
		OR (entry_type IN ('payment', 'refund') AND cash_flow_id IS NOT NULL AND invoice_id IS NULL)
	)
)`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "CHK_e267995432daf0af1afbacd1a6"`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."client_ledger_entry_type_enum_old" AS ENUM('invoice', 'reversal', 'invoice_cancel', 'payment', 'refund')`,
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
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "CHK_8aa451df0c927056ba4aae12a9" CHECK ((((entry_type = ANY (ARRAY['invoice'::client_ledger_entry_type_enum, 'reversal'::client_ledger_entry_type_enum, 'invoice_cancel'::client_ledger_entry_type_enum])) AND (invoice_id IS NOT NULL) AND (cash_flow_id IS NULL)) OR ((entry_type = ANY (ARRAY['payment'::client_ledger_entry_type_enum, 'refund'::client_ledger_entry_type_enum])) AND (cash_flow_id IS NOT NULL) AND (invoice_id IS NULL))))`,
		);
	}
}
