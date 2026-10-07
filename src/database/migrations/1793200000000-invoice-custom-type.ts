import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The `custom` invoice type: a document built by hand for a client, with no order behind it.
 *
 * `ADD VALUE` appends to the enum in place. Postgres refuses to *use* an appended value in the
 * transaction that added it, and the migrations run in one transaction, so the check constraint
 * compares the new value as text (`type::text = 'custom'`) - the entity declares the identical
 * expression, which keeps the constraint name in step.
 */
export class InvoiceCustomType1793200000000 implements MigrationInterface {
	name = 'InvoiceCustomType1793200000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_type_enum" ADD VALUE IF NOT EXISTS 'custom'`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_a351634101d40e267e11b9c804"`,
		);
		await queryRunner.query(`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_4588c7976a5159fa26dfe0fe72" CHECK (
	(
		(type = 'shipping' AND order_id IS NOT NULL)
		OR (type = 'subscription' AND subscription_id IS NOT NULL)
		OR (type::text = 'custom' AND order_id IS NULL AND subscription_id IS NULL)
		OR type = 'order'
	)
)`);
	}

	/**
	 * Postgres cannot drop a value from an enum, so the type is rebuilt without it - which fails
	 * while any invoice is still `custom`. Those have to be removed or retyped first.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_4588c7976a5159fa26dfe0fe72"`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."invoice_type_enum_old" AS ENUM('order', 'shipping', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE "public"."invoice_type_enum_old" USING "type"::text::"public"."invoice_type_enum_old"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" SET DEFAULT 'order'`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_type_enum"`);
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_type_enum_old" RENAME TO "invoice_type_enum"`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_a351634101d40e267e11b9c804" CHECK ((((type = 'shipping'::invoice_type_enum) AND (order_id IS NOT NULL)) OR ((type = 'subscription'::invoice_type_enum) AND (subscription_id IS NOT NULL)) OR (type = 'order'::invoice_type_enum)))`,
		);
	}
}
