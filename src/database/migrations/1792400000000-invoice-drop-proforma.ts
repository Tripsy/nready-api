import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `proforma` invoice type and the series that numbered it.
 *
 * A proforma is a quote, not a fiscal document, and nothing in this deployment issues one - so it
 * was a third type on `invoice.type` and a `document_series` row that no allocation could ever
 * reach. Both enums lose the value; `charge` and `credit_note` stay.
 *
 * Postgres cannot remove a value from an enum, so each column is moved onto a freshly created
 * type and the old one dropped. `up()` refuses rather than destroying data if a proforma document
 * exists or its series has handed out a number: the cast would fail on the first anyway, and the
 * second would mean a reference is already printed on something.
 */
export class InvoiceDropProforma1792400000000 implements MigrationInterface {
	name = 'InvoiceDropProforma1792400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const [invoices]: [{ count: string }] = await queryRunner.query(
			`SELECT count(*)::text AS count FROM "invoice" WHERE "type" = 'proforma'`,
		);

		if (Number(invoices.count) > 0) {
			throw new Error(
				`Cannot drop the proforma invoice type: ${invoices.count} document(s) still use it`,
			);
		}

		const [allocated]: [{ count: string }] = await queryRunner.query(
			`SELECT count(*)::text AS count FROM "document_series"
			 WHERE "document_type" = 'proforma' AND "next_number" > "start_number"`,
		);

		if (Number(allocated.count) > 0) {
			throw new Error(
				'Cannot drop the proforma series: it has already handed out a number',
			);
		}

		await queryRunner.query(
			`DELETE FROM "document_series" WHERE "document_type" = 'proforma'`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."invoice_type_enum_new" AS ENUM('charge', 'credit_note')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE "public"."invoice_type_enum_new" USING "type"::"text"::"public"."invoice_type_enum_new"`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_type_enum"`);
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_type_enum_new" RENAME TO "invoice_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" SET DEFAULT 'charge'`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum_new" AS ENUM('invoice', 'credit_note', 'order', 'grn', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "document_series" ALTER COLUMN "document_type" TYPE "public"."document_series_document_type_enum_new" USING "document_type"::"text"::"public"."document_series_document_type_enum_new"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum_new" RENAME TO "document_series_document_type_enum"`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		/*
		 * The value is put back by rebuilding each type rather than with `ALTER TYPE ... ADD
		 * VALUE`: Postgres refuses to *use* a value added to an enum inside the transaction that
		 * added it, and the series row below is inserted with it in this same migration.
		 */
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_type_enum_new" AS ENUM('charge', 'proforma', 'credit_note')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE "public"."invoice_type_enum_new" USING "type"::"text"::"public"."invoice_type_enum_new"`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_type_enum"`);
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_type_enum_new" RENAME TO "invoice_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" SET DEFAULT 'charge'`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum_new" AS ENUM('invoice', 'proforma', 'credit_note', 'order', 'grn', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "document_series" ALTER COLUMN "document_type" TYPE "public"."document_series_document_type_enum_new" USING "document_type"::"text"::"public"."document_series_document_type_enum_new"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum_new" RENAME TO "document_series_document_type_enum"`,
		);

		await queryRunner.query(
			`INSERT INTO "document_series" ("document_type", "code")
			 SELECT 'proforma', 'PF'
			 WHERE NOT EXISTS (
			   SELECT 1 FROM "document_series" WHERE "document_type" = 'proforma'
			 )`,
		);
	}
}
