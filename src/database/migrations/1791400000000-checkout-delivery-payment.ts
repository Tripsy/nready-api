import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a checkout records beyond its lines: how the goods travel and how the client pays.
 *
 * `order_shipping.method` becomes an enum and NOT NULL - every shipment travels somehow, and a free
 * string let two spellings of the same method into the index. Nothing wrote the table before this
 * migration, so the cast has no legacy value to map; a row holding anything outside the enum makes
 * the `USING` cast fail loudly rather than being coerced.
 *
 * `order.payment_method` is nullable: a back-office document may be raised before settlement is
 * agreed.
 *
 * The index on `method` is dropped and recreated around the type change, since Postgres rebuilds
 * it anyway and an explicit pair keeps `down` symmetric.
 */
export class CheckoutDeliveryPayment1791400000000
	implements MigrationInterface
{
	name = 'CheckoutDeliveryPayment1791400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."order_shipping_method_enum" AS ENUM('self_pickup', 'courier')`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_shipping_method"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "method" TYPE "public"."order_shipping_method_enum" USING "method"::"public"."order_shipping_method_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "method" SET NOT NULL`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order_shipping"."method" IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_method" ON "order_shipping" ("method")`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."order_payment_method_enum" AS ENUM('cash_on_delivery', 'card', 'bank_transfer')`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ADD "payment_method" "public"."order_payment_method_enum"`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" DROP COLUMN "payment_method"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."order_payment_method_enum"`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_shipping_method"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "method" DROP NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "method" TYPE character varying USING "method"::text`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order_shipping"."method" IS 'eg: courier, pickup, same-day, own-fleet, etc'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_method" ON "order_shipping" ("method")`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."order_shipping_method_enum"`,
		);
	}
}
