import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops soft delete from the whole option aggregate - `product_option_group`, `product_option` and
 * `product_option_price`.
 *
 * None of the three has a CRUD surface of its own: no list, no route, no policy. They are written
 * only as one aggregate by `ProductOptionRepository`, from the product form's Options tab, so a
 * question, an answer or a currency dropped from that form is now deleted outright and the cascades
 * carry the levels below it.
 *
 * The sync no longer revives a row by its label. Re-adding an answer that was removed mints a new
 * id, and the ids recorded in `order_line.options[].option_id` and `cart_item.options` carry no
 * foreign key to follow - so they stop resolving, a cart line reporting `OPTION_GONE` and an order
 * line keeping only the wording its snapshot froze.
 *
 * `up()` deletes the soft-deleted rows before dropping the columns: leaving them would silently
 * return them to the catalog as live rows, which is the one thing the columns were still doing.
 * Two partial unique indexes are rebuilt without their `deleted_at IS NULL` predicate - the option
 * one preselects at most one answer per group, the price one holds one delta per currency.
 *
 * `down()` restores the shape but not the data: the rows deleted above are gone, and every
 * surviving row comes back live.
 */
export class ProductOptionDropDeletedAt1791100000000
	implements MigrationInterface
{
	name = 'ProductOptionDropDeletedAt1791100000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Child first, though each parent's cascade would reach the rows below it anyway
		await queryRunner.query(
			`DELETE FROM "product_option_price" WHERE "deleted_at" IS NOT NULL`,
		);
		await queryRunner.query(
			`DELETE FROM "product_option" WHERE "deleted_at" IS NOT NULL`,
		);
		await queryRunner.query(
			`DELETE FROM "product_option_group" WHERE "deleted_at" IS NOT NULL`,
		);

		// The predicates read the columns, so the indexes go first and are rebuilt without them
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_default"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_price_unique"`,
		);

		await queryRunner.query(
			`ALTER TABLE "product_option_price" DROP COLUMN "deleted_at"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option" DROP COLUMN "deleted_at"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_group" DROP COLUMN "deleted_at"`,
		);

		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_option_default" ON "product_option" ("option_group_id") WHERE "is_default" = true`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_option_price_unique" ON "product_option_price" ("option_id", "currency")`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_price_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_default"`,
		);

		await queryRunner.query(
			`ALTER TABLE "product_option_group" ADD "deleted_at" TIMESTAMP`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option" ADD "deleted_at" TIMESTAMP`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_price" ADD "deleted_at" TIMESTAMP`,
		);

		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_option_default" ON "product_option" ("option_group_id") WHERE "is_default" = true AND "deleted_at" IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_option_price_unique" ON "product_option_price" ("option_id", "currency") WHERE "deleted_at" IS NULL`,
		);
	}
}
