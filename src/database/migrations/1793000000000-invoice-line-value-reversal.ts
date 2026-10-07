import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `invoice_line.is_value_reversal`: a reversal line that takes back value (a price correction)
 * rather than quantity. Every existing reversal line took back quantity, which is the default.
 */
export class InvoiceLineValueReversal1793000000000
	implements MigrationInterface
{
	name = 'InvoiceLineValueReversal1793000000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice_line" ADD "is_value_reversal" boolean NOT NULL DEFAULT false`,
		);
		await queryRunner.query(`ALTER TABLE "invoice_line" ADD CONSTRAINT "CHK_e696f079a6042f4824d804eea5" CHECK (
	(
		is_value_reversal = false
		OR (parent_line_id IS NOT NULL AND order_line_id IS NULL AND shipping_id IS NULL)
	)
)`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP CONSTRAINT "CHK_e696f079a6042f4824d804eea5"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP COLUMN "is_value_reversal"`,
		);
	}
}
