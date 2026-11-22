import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `order_return.refund_shipping` - whether a return's refund also pays back the outbound delivery
 * fee - and the `RMA` series row returns number from.
 *
 * The series row is inserted here rather than left to the `document-series` seed: a deployment
 * that seeded its series before returns existed would otherwise answer `not_configured` on the
 * first return request, and `migrate` is the one step every deployment is guaranteed to run.
 * Inserted only when missing, so a database already seeded keeps its own code and counter.
 */
export class OrderReturnRefundShipping1795800000000
	implements MigrationInterface
{
	name = 'OrderReturnRefundShipping1795800000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_return" ADD "refund_shipping" boolean NOT NULL DEFAULT false`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order_return"."refund_shipping" IS 'Refund the outbound delivery fee with the goods; read when the refund is drafted'`,
		);

		await queryRunner.query(
			`INSERT INTO "document_series" ("document_type", "code")
			 SELECT 'order_return', 'RMA'
			 WHERE NOT EXISTS (
			   SELECT 1 FROM "document_series" WHERE "document_type" = 'order_return'
			 )`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// The series row stays: `1795700000000-order-return` drops it on its own way down, and
		// only while it has handed out no number
		await queryRunner.query(
			`ALTER TABLE "order_return" DROP COLUMN "refund_shipping"`,
		);
	}
}
