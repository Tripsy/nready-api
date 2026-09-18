import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `order.billing_details` - the counterparty and billing address as they stood when the order
 * was placed, shaped like `invoice.billing_details` so an invoice raised from the order can copy it.
 *
 * A snapshot rather than a reference: a client address can be edited or deleted outright, and an
 * order must keep saying who it was billed to. Nullable, since a back-office document may be raised
 * before a billing address is known.
 */
export class OrderBillingDetails1791500000000 implements MigrationInterface {
	name = 'OrderBillingDetails1791500000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" ADD "billing_details" jsonb`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order"."billing_details" IS 'Snapshot of the billing client and address at the moment the order was placed'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" DROP COLUMN "billing_details"`,
		);
	}
}
