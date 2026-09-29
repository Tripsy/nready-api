import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `order.issued_at`; `created_at` is the order's only date.
 *
 * The issue date was what an order's exchange rate and discounts were resolved against, and a
 * line edit re-resolves them against `created_at` now. `up()` therefore copies the issue date
 * into `created_at` before the column goes, so a backdated order keeps the date its money was
 * frozen at and the order book keeps its dates.
 *
 * `down()` restores the column from `created_at`, which after `up()` holds the issue date, and
 * cannot give back the original insert timestamps `up()` overwrote.
 */
export class OrderDropIssuedAt1792800000000 implements MigrationInterface {
	name = 'OrderDropIssuedAt1792800000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "order" SET "created_at" = "issued_at" WHERE "created_at" <> "issued_at"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_order_issued_at"`);
		await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "issued_at"`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" ADD "issued_at" TIMESTAMP`,
		);
		await queryRunner.query(
			`UPDATE "order" SET "issued_at" = "created_at"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "issued_at" SET NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_issued_at" ON "order" ("issued_at") `,
		);
	}
}
