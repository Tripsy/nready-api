import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `order.type` and its enum type. The column carried no behavior - nothing branched on it,
 * and a subscription is tied to its order through `subscription.order_id`.
 *
 * `down` restores the column with every row at its old default, `standard`: the values written
 * before the drop are not recoverable.
 */
export class OrderDropType1794000000000 implements MigrationInterface {
	name = 'OrderDropType1794000000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "type"`);
		await queryRunner.query(`DROP TYPE "public"."order_type_enum"`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."order_type_enum" AS ENUM('standard', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ADD "type" "public"."order_type_enum" NOT NULL DEFAULT 'standard'`,
		);
	}
}
