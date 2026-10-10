import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an invoice stand without an order behind it.
 *
 * A revenue movement may be invoiced on its own - money banked against a client with nothing in
 * the catalogue to itemize - and such a document carries a single line built from the movement
 * rather than from order lines and shipping. The foreign key stays `RESTRICT`; only the NOT NULL
 * goes.
 *
 * `down()` refuses rather than destroying data if any order-less document exists, since there is
 * nothing to put back in the column.
 */
export class InvoiceOrderOptional1792700000000 implements MigrationInterface {
	name = 'InvoiceOrderOptional1792700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "order_id" DROP NOT NULL`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		const [orphans]: [{ count: string }] = await queryRunner.query(
			`SELECT count(*)::text AS count FROM "invoice" WHERE "order_id" IS NULL`,
		);

		if (Number(orphans.count) > 0) {
			throw new Error(
				`Cannot require invoice.order_id: ${orphans.count} document(s) have no order behind them`,
			);
		}

		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "order_id" SET NOT NULL`,
		);
	}
}
