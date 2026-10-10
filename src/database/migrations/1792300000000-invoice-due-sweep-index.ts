import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The partial index the overdue sweep reads: issued invoices past their due date that have not
 * been stamped yet.
 *
 * The predicate is the sweep's own end state, so the index holds only the rows still to be looked
 * at and a stamped row leaves it. Without it, `invoice-overdue.cron.ts` scans the whole table every
 * night for the handful that just went late.
 *
 * Hand-written rather than generated: `migration:generate` picks up unrelated drift from other
 * branches - constraint renames, `document_series` columns - alongside the one statement wanted
 * here.
 */
export class InvoiceDueSweepIndex1792300000000 implements MigrationInterface {
	name = 'InvoiceDueSweepIndex1792300000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_due_sweep" ON "invoice" ("due_at") WHERE deleted_at IS NULL AND overdue_at IS NULL AND due_at IS NOT NULL AND status = 'issued'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_due_sweep"`);
	}
}
