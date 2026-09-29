import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `order` to the kinds of thing a cash movement can be recorded against.
 *
 * This is what lets a payment exist before there is anything to allocate it to: an online checkout
 * asks for the money up front and the invoice is only raised once it lands, so at request time
 * `invoice_payment` has no row to point at. See `operational-record.entity.ts` for why it is
 * recorded here rather than as a column on `cash_flow`.
 *
 * `ADD VALUE` cannot run inside a transaction block on Postgres below 12, and TypeORM wraps a
 * migration in one - so the type is rebuilt the way `1792400000000-invoice-drop-proforma.ts`
 * rebuilds it to remove a value. `down()` refuses rather than destroying data if any movement is
 * already recorded against an order.
 */
export class OperationalRecordOrder1792500000000 implements MigrationInterface {
	name = 'OperationalRecordOrder1792500000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."operational_record_operational_record_type_enum_new" AS ENUM('client', 'vendor', 'order')`,
		);

		await queryRunner.query(
			`ALTER TABLE "operational_record" ALTER COLUMN "operational_record_type" TYPE "public"."operational_record_operational_record_type_enum_new"
			 USING "operational_record_type"::text::"public"."operational_record_operational_record_type_enum_new"`,
		);

		await queryRunner.query(
			`DROP TYPE "public"."operational_record_operational_record_type_enum"`,
		);

		await queryRunner.query(
			`ALTER TYPE "public"."operational_record_operational_record_type_enum_new" RENAME TO "operational_record_operational_record_type_enum"`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		const [records]: [{ count: string }] = await queryRunner.query(
			`SELECT count(*)::text AS count FROM "operational_record" WHERE "operational_record_type" = 'order'`,
		);

		if (Number(records.count) > 0) {
			throw new Error(
				`Cannot drop the order operational record type: ${records.count} movement(s) still use it`,
			);
		}

		await queryRunner.query(
			`CREATE TYPE "public"."operational_record_operational_record_type_enum_old" AS ENUM('client', 'vendor')`,
		);

		await queryRunner.query(
			`ALTER TABLE "operational_record" ALTER COLUMN "operational_record_type" TYPE "public"."operational_record_operational_record_type_enum_old"
			 USING "operational_record_type"::text::"public"."operational_record_operational_record_type_enum_old"`,
		);

		await queryRunner.query(
			`DROP TYPE "public"."operational_record_operational_record_type_enum"`,
		);

		await queryRunner.query(
			`ALTER TYPE "public"."operational_record_operational_record_type_enum_old" RENAME TO "operational_record_operational_record_type_enum"`,
		);
	}
}
