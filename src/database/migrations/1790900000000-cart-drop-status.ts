import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the cart lifecycle.
 *
 * A cart now exists while somebody is filling it and is deleted the moment it stops being that:
 * checked out, folded into an account's own at sign-in, or left untouched past `expires_at`. That
 * removes `status` (there is no state between live and gone), `order_id` (the cart it named no
 * longer exists by the time anyone could follow the link) and `deleted_at` on both tables - a
 * soft-deleted cart would be a row that is neither a live basket nor gone.
 *
 * `up()` deletes rows that cannot survive the change: carts already terminal or soft-deleted, and
 * soft-deleted lines. They are baskets, not documents - nothing downstream references them, and
 * `UQ_cart_user` could not be created with the terminal rows still in place.
 *
 * `down()` restores the shape but not the data: every surviving cart comes back as `active`, and
 * the rows deleted above are gone for good.
 */
export class CartDropStatus1790900000000 implements MigrationInterface {
	name = 'CartDropStatus1790900000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Terminal and soft-deleted carts have no meaning under the new model, and the member
		// ones among them would collide with the unqualified `UQ_cart_user` below. The lines go
		// with them through the `cart_item.cart_id` cascade.
		await queryRunner.query(
			`DELETE FROM "cart" WHERE "status" <> 'active' OR "deleted_at" IS NOT NULL`,
		);
		await queryRunner.query(
			`DELETE FROM "cart_item" WHERE "deleted_at" IS NOT NULL`,
		);

		await queryRunner.query(`DROP INDEX "public"."UQ_cart_user_active"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_cart_expires_at"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_cart_order_id"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_line"`);

		await queryRunner.query(
			`ALTER TABLE "cart" DROP CONSTRAINT "FK_cart_order"`,
		);
		await queryRunner.query(`ALTER TABLE "cart" DROP COLUMN "order_id"`);
		await queryRunner.query(`ALTER TABLE "cart" DROP COLUMN "status"`);
		await queryRunner.query(`ALTER TABLE "cart" DROP COLUMN "deleted_at"`);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP COLUMN "deleted_at"`,
		);

		await queryRunner.query(`DROP TYPE "public"."cart_status_enum"`);

		// One cart per member, with no status left to qualify it.
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_user" ON "cart" ("user_id") WHERE user_id IS NOT NULL`,
		);
		// The cleanup cron's whole query, now unpartitioned - every row is a live cart.
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_expires_at" ON "cart" ("expires_at")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_line" ON "cart_item" ("cart_id", "variant_id", "options_hash")`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_line"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_cart_expires_at"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_user"`);

		await queryRunner.query(
			`CREATE TYPE "public"."cart_status_enum" AS ENUM('active', 'converted', 'abandoned')`,
		);

		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD "deleted_at" TIMESTAMP`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart" ADD "deleted_at" TIMESTAMP`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart" ADD "status" "public"."cart_status_enum" NOT NULL DEFAULT 'active'`,
		);
		await queryRunner.query(`ALTER TABLE "cart" ADD "order_id" integer`);

		await queryRunner.query(
			`ALTER TABLE "cart" ADD CONSTRAINT "FK_cart_order" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);

		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_line" ON "cart_item" ("cart_id", "variant_id", "options_hash") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_order_id" ON "cart" ("order_id") WHERE order_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_expires_at" ON "cart" ("expires_at") WHERE status = 'active' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_user_active" ON "cart" ("user_id") WHERE user_id IS NOT NULL AND status = 'active' AND deleted_at IS NULL`,
		);
	}
}
