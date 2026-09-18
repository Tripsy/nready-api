import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes `draft` from `order_status_enum`. Every order enters at `pending` - from a checkout or
 * the back office - and `pending` is where its lines may still be adjusted.
 *
 * Postgres cannot drop a value from an enum in place, so the type is rebuilt and the column
 * converted onto it, as in `1787800000000-complaint-reason-enum.ts`. Rows still `draft` are
 * remapped to `pending` inside the `USING` clause, keeping the conversion a single statement.
 *
 * The column default has to come off first and go back on afterwards: it is a `'draft'` literal
 * of the old type, and Postgres refuses to convert a column whose default cannot be cast onto the
 * new one.
 *
 * Lossy on the way down, deliberately: nothing records which `pending` orders were drafts, so they
 * all stay `pending`; only the default returns to `draft`.
 */
export class OrderStatusDropDraft1790800000000 implements MigrationInterface {
	name = 'OrderStatusDropDraft1790800000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."order_status_enum" RENAME TO "order_status_enum_old"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_status_enum" AS ENUM('pending', 'confirmed', 'completed', 'canceled')`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "status" TYPE "public"."order_status_enum" USING (CASE WHEN "status"::text = 'draft' THEN 'pending' ELSE "status"::text END)::"public"."order_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "status" SET DEFAULT 'pending'`,
		);
		await queryRunner.query(`DROP TYPE "public"."order_status_enum_old"`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."order_status_enum" RENAME TO "order_status_enum_new"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_status_enum" AS ENUM('draft', 'pending', 'confirmed', 'completed', 'canceled')`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "status" TYPE "public"."order_status_enum" USING "status"::text::"public"."order_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ALTER COLUMN "status" SET DEFAULT 'draft'`,
		);
		await queryRunner.query(`DROP TYPE "public"."order_status_enum_new"`);
	}
}
