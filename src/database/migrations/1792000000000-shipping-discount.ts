import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `shipping` discount scope, and the column a shipment records what its discount took off
 * in - the counterpart of `order_line.discount_reduction`, and the figure VAT on a shipment is
 * charged after.
 *
 * `ADD VALUE` rather than the type swap `DiscountScope1786500000000` needed: appending a value is
 * the one enum change Postgres supports in place.
 */
export class ShippingDiscount1792000000000 implements MigrationInterface {
	name = 'ShippingDiscount1792000000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."discount_scope_enum" ADD VALUE IF NOT EXISTS 'shipping'`,
		);

		await queryRunner.query(
			`ALTER TABLE "shipping" ADD "discount_reduction" numeric(12,2) NOT NULL DEFAULT '0'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."discount_reduction" IS 'Money off the price, excluding VAT, in the shipment currency'`,
		);
	}

	/**
	 * Postgres cannot remove an enum value, so the type is swapped for one without it - which fails
	 * while any discount still uses the scope. Refused outright instead: there is no scope a shipping
	 * discount could fold into without starting to reduce the goods, and deleting the rows would
	 * erase rules somebody wrote.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		const rows: { count: string }[] = await queryRunner.query(
			`SELECT COUNT(*) AS count FROM "discount" WHERE "scope" = 'shipping'`,
		);

		if (Number(rows[0]?.count ?? 0) > 0) {
			throw new Error(
				'Cannot revert ShippingDiscount1792000000000: discounts with scope "shipping" exist. Delete or re-scope them first.',
			);
		}

		await queryRunner.query(
			`ALTER TABLE "shipping" DROP COLUMN "discount_reduction"`,
		);

		await queryRunner.query(`DROP INDEX "public"."IDX_discount_active"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_discount_scope"`);

		await queryRunner.query(
			`CREATE TYPE "public"."discount_scope_enum_old" AS ENUM('client', 'order', 'product', 'variant', 'category', 'brand')`,
		);
		await queryRunner.query(
			`ALTER TABLE "discount" ALTER COLUMN "scope" TYPE "public"."discount_scope_enum_old" USING "scope"::text::"public"."discount_scope_enum_old"`,
		);
		await queryRunner.query(`DROP TYPE "public"."discount_scope_enum"`);
		await queryRunner.query(
			`ALTER TYPE "public"."discount_scope_enum_old" RENAME TO "discount_scope_enum"`,
		);

		await queryRunner.query(
			`CREATE INDEX "IDX_discount_scope" ON "discount" ("scope") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_discount_active" ON "discount" ("start_at", "end_at", "scope") `,
		);
	}
}
