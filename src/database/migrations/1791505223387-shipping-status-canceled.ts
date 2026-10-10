import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `canceled` to `shipping.status`: a delivery withdrawn before it left, because its order was
 * canceled.
 *
 * **`down()` folds `canceled` into `failed`** - the nearest older status that bills nothing and
 * moves nothing - since an enum value still in use cannot be dropped.
 */
export class ShippingStatusCanceled1791505223387 implements MigrationInterface {
	name = 'ShippingStatusCanceled1791505223387';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."shipping_status_enum" ADD VALUE IF NOT EXISTS 'canceled'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "shipping" SET "status" = 'failed' WHERE "status" = 'canceled'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_status_enum_old" AS ENUM('pending', 'preparing', 'shipped', 'delivered', 'failed', 'returned')`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ALTER COLUMN "status" TYPE "public"."shipping_status_enum_old" USING "status"::"text"::"public"."shipping_status_enum_old"`,
		);
		await queryRunner.query(`DROP TYPE "public"."shipping_status_enum"`);
		await queryRunner.query(
			`ALTER TYPE "public"."shipping_status_enum_old" RENAME TO "shipping_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ALTER COLUMN "status" SET DEFAULT 'pending'`,
		);
	}
}
