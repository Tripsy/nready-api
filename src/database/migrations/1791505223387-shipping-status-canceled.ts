import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `canceled` to the delivery status: a delivery withdrawn before it left, because its order
 * was canceled.
 *
 * **Addresses the names of its own point in the sequence** - `order_shipping` and
 * `order_shipping_status_enum`. This timestamp sorts before `1791700000000-shipping-scope`, which
 * renames both to `shipping` / `shipping_status_enum` and carries the value across. A database
 * migrated from empty runs the two in that order and has no `shipping_status_enum` yet; one that
 * applied this migration after the rename keeps it recorded by name and never runs it again.
 *
 * **`down()` folds `canceled` into `failed`** - the nearest older status that bills nothing and
 * moves nothing - since an enum value still in use cannot be dropped.
 */
export class ShippingStatusCanceled1791505223387 implements MigrationInterface {
	name = 'ShippingStatusCanceled1791505223387';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."order_shipping_status_enum" ADD VALUE IF NOT EXISTS 'canceled'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "order_shipping" SET "status" = 'failed' WHERE "status" = 'canceled'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_shipping_status_enum_old" AS ENUM('pending', 'preparing', 'shipped', 'delivered', 'failed', 'returned')`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "status" TYPE "public"."order_shipping_status_enum_old" USING "status"::"text"::"public"."order_shipping_status_enum_old"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."order_shipping_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."order_shipping_status_enum_old" RENAME TO "order_shipping_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ALTER COLUMN "status" SET DEFAULT 'pending'`,
		);
	}
}
