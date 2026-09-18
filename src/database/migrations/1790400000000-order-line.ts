import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames `order_product` → `order_line`, and the column pointing at it from
 * `order_shipping_product.order_product_id` → `order_line_id`.
 *
 * The table holds order line items, and a line is not a product: a bundle header line names no
 * sellable row of its own, and the child lines it explodes into each carry an apportioned share of
 * one bundle price. "Line" is the word the service layer, the seeds and the product rules already
 * use for these rows, so the table now reads the same as the code around it.
 *
 * `RENAME TO` / `RENAME COLUMN` preserve the data, and Postgres follows the rename through every
 * dependent index, constraint and foreign key - but those all keep their old names, and TypeORM
 * derives check and foreign-key names by hashing the table name together with the columns. Left
 * alone, every later `migration:generate` would try to drop and re-add them, so each is renamed
 * here to the name the new table name hashes to. `RENAME CONSTRAINT` and `ALTER INDEX` are
 * metadata edits: nothing is re-validated and no index is rebuilt.
 *
 * The auto-generated not-null constraint names (`order_product_*_not_null`) are left alone -
 * Postgres owns them and TypeORM neither reads nor diffs them.
 */
export class OrderLine1790400000000 implements MigrationInterface {
	name = 'OrderLine1790400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_product" RENAME TO "order_line"`,
		);
		await queryRunner.query(
			`ALTER SEQUENCE "order_product_id_seq" RENAME TO "order_line_id_seq"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_line" IS 'Stores order line items'`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_product" RENAME COLUMN "order_product_id" TO "order_line_id"`,
		);

		await queryRunner.query(
			`ALTER INDEX "IDX_order_product_order_id" RENAME TO "IDX_order_line_order_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_product_parent_id" RENAME TO "IDX_order_line_parent_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_product_variant_id" RENAME TO "IDX_order_line_variant_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_product_product_id" RENAME TO "IDX_order_line_product_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_shipping_product_order_product_id" RENAME TO "IDX_order_shipping_product_order_line_id"`,
		);

		// The checks and foreign keys, under the names the renamed table hashes to.
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "CHK_e71eab477ca6cbf5acb9f171d5" TO "CHK_3166f9d6b8cd45aaa56376fc5b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "CHK_be8863bcda53a503e92b119947" TO "CHK_6525a883b48cf5636f57201377"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "CHK_b1af8657d76f9d945f0980b51d" TO "CHK_b4c4e3bfaf46f359f9e28b8a66"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "FK_ea143999ecfa6a152f2202895e2" TO "FK_ed8fae6d7239e9d730219215af7"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "FK_94c940b8f640f6e75a9a2a2c18b" TO "FK_e67ffe518d35eaa81833836b3bb"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "FK_6ce14d73db7519acf7853313720" TO "FK_aec0fb36aff8abc5db26f27a6df"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_product" RENAME CONSTRAINT "FK_66811564f24eb71ac15e5ea124b" TO "FK_0233e88ceeca4614a5b17302327"`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_shipping_product" RENAME CONSTRAINT "FK_0233e88ceeca4614a5b17302327" TO "FK_66811564f24eb71ac15e5ea124b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "FK_aec0fb36aff8abc5db26f27a6df" TO "FK_6ce14d73db7519acf7853313720"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "FK_e67ffe518d35eaa81833836b3bb" TO "FK_94c940b8f640f6e75a9a2a2c18b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "FK_ed8fae6d7239e9d730219215af7" TO "FK_ea143999ecfa6a152f2202895e2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "CHK_b4c4e3bfaf46f359f9e28b8a66" TO "CHK_b1af8657d76f9d945f0980b51d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "CHK_6525a883b48cf5636f57201377" TO "CHK_be8863bcda53a503e92b119947"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME CONSTRAINT "CHK_3166f9d6b8cd45aaa56376fc5b" TO "CHK_e71eab477ca6cbf5acb9f171d5"`,
		);

		await queryRunner.query(
			`ALTER INDEX "IDX_order_shipping_product_order_line_id" RENAME TO "IDX_order_shipping_product_order_product_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_line_product_id" RENAME TO "IDX_order_product_product_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_line_variant_id" RENAME TO "IDX_order_product_variant_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_line_parent_id" RENAME TO "IDX_order_product_parent_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_line_order_id" RENAME TO "IDX_order_product_order_id"`,
		);

		await queryRunner.query(
			`ALTER TABLE "order_shipping_product" RENAME COLUMN "order_line_id" TO "order_product_id"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_line" IS 'Stores ordered products (order line items)'`,
		);
		await queryRunner.query(
			`ALTER SEQUENCE "order_line_id_seq" RENAME TO "order_product_id_seq"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" RENAME TO "order_product"`,
		);
	}
}
