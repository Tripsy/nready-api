import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames `order_shipping_product` → `order_shipping_line`, following `order_line`.
 *
 * The table allocates order lines to shipments, one row per line per shipment - it never points at
 * a product. Its own column already reads `order_line_id`, so the table name was the last place
 * still calling a line a product.
 *
 * `warehouse_movement.source_type` names the table a movement came from, so the enum label moves
 * with it. `RENAME VALUE` rewrites the label in place: existing rows keep pointing at the same
 * `source_id`, and no row is rewritten.
 *
 * As in the `order_line` rename, Postgres carries indexes and constraints through the rename under
 * their old names while TypeORM derives check and foreign-key names by hashing the table name with
 * the columns - so each is renamed here to the name the new table name hashes to, keeping later
 * `migration:generate` runs quiet. Every statement is a metadata edit: nothing is re-validated and
 * no index is rebuilt.
 */
export class OrderShippingLine1790500000000 implements MigrationInterface {
	name = 'OrderShippingLine1790500000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_shipping_product" RENAME TO "order_shipping_line"`,
		);
		await queryRunner.query(
			`ALTER SEQUENCE "order_shipping_product_id_seq" RENAME TO "order_shipping_line_id_seq"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_shipping_line" IS 'Allocation of order lines to specific shipments'`,
		);

		await queryRunner.query(
			`ALTER INDEX "IDX_order_shipping_product_unique" RENAME TO "IDX_order_shipping_line_unique"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_shipping_product_order_line_id" RENAME TO "IDX_order_shipping_line_order_line_id"`,
		);

		// The check and foreign keys, under the names the renamed table hashes to.
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME CONSTRAINT "CHK_57a3c56d56194ae524e99f9e04" TO "CHK_2feff637a0261c3886c368ed6d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME CONSTRAINT "FK_0233e88ceeca4614a5b17302327" TO "FK_91df41bc0968ff982d1d464512b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME CONSTRAINT "FK_08f57f381c1c316fd7bc0d8b3e6" TO "FK_81e278ef1dcae55494ba16d917c"`,
		);

		await queryRunner.query(
			`ALTER TYPE "warehouse_movement_source_type_enum" RENAME VALUE 'order_shipping_product' TO 'order_shipping_line'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "warehouse_movement_source_type_enum" RENAME VALUE 'order_shipping_line' TO 'order_shipping_product'`,
		);

		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME CONSTRAINT "FK_81e278ef1dcae55494ba16d917c" TO "FK_08f57f381c1c316fd7bc0d8b3e6"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME CONSTRAINT "FK_91df41bc0968ff982d1d464512b" TO "FK_0233e88ceeca4614a5b17302327"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME CONSTRAINT "CHK_2feff637a0261c3886c368ed6d" TO "CHK_57a3c56d56194ae524e99f9e04"`,
		);

		await queryRunner.query(
			`ALTER INDEX "IDX_order_shipping_line_order_line_id" RENAME TO "IDX_order_shipping_product_order_line_id"`,
		);
		await queryRunner.query(
			`ALTER INDEX "IDX_order_shipping_line_unique" RENAME TO "IDX_order_shipping_product_unique"`,
		);

		await queryRunner.query(
			`COMMENT ON TABLE "order_shipping_line" IS 'Allocation of ordered products to specific shipments'`,
		);
		await queryRunner.query(
			`ALTER SEQUENCE "order_shipping_line_id_seq" RENAME TO "order_shipping_product_id_seq"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" RENAME TO "order_shipping_product"`,
		);
	}
}
