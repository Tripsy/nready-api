import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames `invoice.type` to `invoice.scope`, with its enum type and index, to the names TypeORM
 * derives for the new column. A rename only: no value or row changes.
 */
export class InvoiceScope1793900000000 implements MigrationInterface {
	name = 'InvoiceScope1793900000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice" RENAME COLUMN "type" TO "scope"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_type_enum" RENAME TO "invoice_scope_enum"`,
		);
		await queryRunner.query(
			`ALTER INDEX "public"."IDX_invoice_type" RENAME TO "IDX_invoice_scope"`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER INDEX "public"."IDX_invoice_scope" RENAME TO "IDX_invoice_type"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_scope_enum" RENAME TO "invoice_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" RENAME COLUMN "scope" TO "type"`,
		);
	}
}
