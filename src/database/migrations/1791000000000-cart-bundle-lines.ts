import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives `cart_item` the header-and-components shape a bundle needs, mirroring `order_line`
 * (`product.md` §8.3): `parent_id` links a component row to the bundle line it belongs to, and
 * `bundle_item_id` says which `product_bundle_item` it materializes.
 *
 * `UQ_cart_item_line` has to be rebuilt rather than extended. A component row carries the same
 * `variant_id` as a standalone line of that variant, so the old unqualified key would make fries
 * inside a menu collide with fries on their own. Adding `parent_id` to the key instead would break
 * the dedupe it exists for - nulls are distinct in a Postgres unique index, so every ordinary line
 * would stop matching itself. Two partial indexes say it properly: one over the lines a shopper
 * added directly, one over the components of a bundle.
 *
 * No data migration. Every existing row is an ordinary line, which is exactly what
 * `parent_id IS NULL` describes, so the rebuilt index covers them unchanged.
 */
export class CartBundleLines1791000000000 implements MigrationInterface {
	name = 'CartBundleLines1791000000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD "parent_id" integer`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD "bundle_item_id" integer`,
		);

		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_line"`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_line" ON "cart_item" ("cart_id", "variant_id", "options_hash") WHERE parent_id IS NULL`,
		);
		// A bundle contains a given component once.
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_component" ON "cart_item" ("parent_id", "bundle_item_id") WHERE parent_id IS NOT NULL`,
		);
		// Reading a bundle line reads its components.
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_item_parent_id" ON "cart_item" ("parent_id") WHERE parent_id IS NOT NULL`,
		);

		// CASCADE: the components exist only to say what the header contains.
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD CONSTRAINT "FK_cart_item_parent" FOREIGN KEY ("parent_id") REFERENCES "cart_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD CONSTRAINT "FK_cart_item_bundle_item" FOREIGN KEY ("bundle_item_id") REFERENCES "product_bundle_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// The component rows have nowhere to go once the columns do - they are not ordinary lines
		// and would read as duplicates of their own header's variant under the restored index.
		await queryRunner.query(
			`DELETE FROM "cart_item" WHERE "parent_id" IS NOT NULL`,
		);

		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP CONSTRAINT "FK_cart_item_bundle_item"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP CONSTRAINT "FK_cart_item_parent"`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_cart_item_parent_id"`,
		);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_component"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_line"`);

		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP COLUMN "bundle_item_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP COLUMN "parent_id"`,
		);

		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_line" ON "cart_item" ("cart_id", "variant_id", "options_hash")`,
		);
	}
}
