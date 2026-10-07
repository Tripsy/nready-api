import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves what an invoice was raised from out of `invoice` and into `invoice_source`: one
 * `(invoice, type, id)` row per order, shipping or subscription, the way `operational_record` files
 * a cash movement. `client_id` stays a column - every invoice has one.
 *
 * Backfilled from the three columns, which then go with their keys, indexes and the checks that
 * tied them to the invoice type - those rules live in the service now. The order key's `RESTRICT`
 * goes with them; see the TODO on `invoice-source.entity.ts`.
 */
export class InvoiceSource1793800000000 implements MigrationInterface {
	name = 'InvoiceSource1793800000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_source_source_type_enum" AS ENUM('order', 'shipping', 'subscription')`,
		);
		await queryRunner.query(
			`CREATE TABLE "invoice_source" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" integer NOT NULL, "source_type" "public"."invoice_source_source_type_enum" NOT NULL, "source_id" integer NOT NULL, CONSTRAINT "PK_26060ccbd4e27f5862d5bd34819" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice_source" IS 'What each invoice was raised from - order, shipping, subscription'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_source_invoice" ON "invoice_source" ("invoice_id", "source_type")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_source_target" ON "invoice_source" ("source_type", "source_id")`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_source" ADD CONSTRAINT "FK_0d3a5605e616742b2f62cae529c" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);

		for (const [column, type] of [
			['order_id', 'order'],
			['shipping_id', 'shipping'],
			['subscription_id', 'subscription'],
		]) {
			await queryRunner.query(
				`INSERT INTO "invoice_source" ("invoice_id", "source_type", "source_id")
				SELECT "id", '${type}', "${column}" FROM "invoice" WHERE "${column}" IS NOT NULL`,
			);
		}

		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_4588c7976a5159fa26dfe0fe72"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_2703341ff2619b6fd29676109d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_1e74a9888e5e228184769ba3dfd"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_fe0167ebf6bb4f571c31009610d"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_order_id"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_subscription_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_shipping_id"`,
		);
		await queryRunner.query(`ALTER TABLE "invoice" DROP COLUMN "order_id"`);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "shipping_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "subscription_id"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice" IS 'Stores invoices'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invoice" ADD "order_id" integer`);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "shipping_id" integer`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "subscription_id" integer`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."subscription_id" IS 'Id of the subscription billed; no key, see the entity'`,
		);

		for (const [column, type] of [
			['order_id', 'order'],
			['shipping_id', 'shipping'],
			['subscription_id', 'subscription'],
		]) {
			await queryRunner.query(
				`UPDATE "invoice" SET "${column}" = s."source_id" FROM "invoice_source" s
				WHERE s."invoice_id" = "invoice"."id" AND s."source_type" = '${type}'`,
			);
		}

		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_order_id" ON "invoice" ("order_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_subscription_id" ON "invoice" ("subscription_id") WHERE subscription_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_shipping_id" ON "invoice" ("shipping_id") WHERE shipping_id IS NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_1e74a9888e5e228184769ba3dfd" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_fe0167ebf6bb4f571c31009610d" FOREIGN KEY ("shipping_id") REFERENCES "shipping"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_2703341ff2619b6fd29676109d" CHECK ((shipping_id IS NULL OR type = 'shipping'))`,
		);
		await queryRunner.query(`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_4588c7976a5159fa26dfe0fe72" CHECK (
	(
		(type = 'shipping' AND order_id IS NOT NULL)
		OR (type = 'subscription' AND subscription_id IS NOT NULL)
		OR (type::text = 'custom' AND order_id IS NULL AND subscription_id IS NULL)
		OR type = 'order'
	)
)`);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice" IS 'Stores invoices generated from orders'`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice_source" DROP CONSTRAINT "FK_0d3a5605e616742b2f62cae529c"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_source_target"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_source_invoice"`,
		);
		await queryRunner.query(`DROP TABLE "invoice_source"`);
		await queryRunner.query(
			`DROP TYPE "public"."invoice_source_source_type_enum"`,
		);
	}
}
