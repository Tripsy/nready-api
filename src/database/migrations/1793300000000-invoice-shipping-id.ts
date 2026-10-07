import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `invoice.shipping_id`: the movement a `shipping` document bills, on the header beside `order_id`
 * and `subscription_id`. Backfilled from the one `shipping` line each such document carries - a
 * reversal included, whose line names its original's movement.
 */
export class InvoiceShippingId1793300000000 implements MigrationInterface {
	name = 'InvoiceShippingId1793300000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "shipping_id" integer`,
		);

		await queryRunner.query(`
			UPDATE "invoice" AS i
			SET "shipping_id" = l."shipping_id"
			FROM (
				SELECT DISTINCT ON ("invoice_id") "invoice_id", "shipping_id"
				FROM "invoice_line"
				WHERE "kind" = 'shipping' AND "shipping_id" IS NOT NULL
				ORDER BY "invoice_id", "id"
			) AS l
			WHERE l."invoice_id" = i."id" AND i."type" = 'shipping'
		`);

		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_shipping_id" ON "invoice" ("shipping_id") WHERE shipping_id IS NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_fe0167ebf6bb4f571c31009610d" FOREIGN KEY ("shipping_id") REFERENCES "shipping"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_2703341ff2619b6fd29676109d" CHECK ((shipping_id IS NULL OR type = 'shipping'))`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_2703341ff2619b6fd29676109d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_fe0167ebf6bb4f571c31009610d"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_shipping_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "shipping_id"`,
		);
	}
}
