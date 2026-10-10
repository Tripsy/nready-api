import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `credit_note` document type. A reversal (storno) is an invoice flagged `is_reversal`
 * and numbers from the `invoice` series, so the separate series was never allocated from.
 *
 * Its row goes first - refused if it ever handed out a number, since a spent number is part of the
 * books - then the enum is rebuilt without the value, which Postgres cannot drop in place.
 */
export class DocumentSeriesDropCreditNote1793500000000
	implements MigrationInterface
{
	name = 'DocumentSeriesDropCreditNote1793500000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const allocated = await queryRunner.query(
			`SELECT id FROM "document_series" WHERE "document_type" = 'credit_note' AND "next_number" <> "start_number"`,
		);

		if (allocated.length > 0) {
			throw new Error(
				'The credit_note series has allocated numbers; it cannot be dropped',
			);
		}

		await queryRunner.query(
			`DELETE FROM "document_series" WHERE "document_type" = 'credit_note'`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum_new" AS ENUM('invoice', 'order', 'grn', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "document_series" ALTER COLUMN "document_type" TYPE "public"."document_series_document_type_enum_new" USING "document_type"::text::"public"."document_series_document_type_enum_new"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum_new" RENAME TO "document_series_document_type_enum"`,
		);
	}

	// The value only: the series row was never used, and nothing seeds it any more
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum" ADD VALUE IF NOT EXISTS 'credit_note' AFTER 'invoice'`,
		);
	}
}
