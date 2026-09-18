import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds what a movement cost the business to carry out, entered by the back office once the
 * carrier's invoice is in.
 *
 * Nullable with no default: existing rows have no recorded cost, and backfilling zero would state
 * that they were free - a margin computed over them could not tell the two apart.
 */
export class ShippingOperationalCost1791800000000
	implements MigrationInterface
{
	name = 'ShippingOperationalCost1791800000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "shipping" ADD "operational_cost" numeric(12,2)`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."operational_cost" IS 'Internal cost of the movement, in base currency'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP COLUMN "operational_cost"`,
		);
	}
}
