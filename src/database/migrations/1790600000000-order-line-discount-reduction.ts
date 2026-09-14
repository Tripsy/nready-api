import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `order_line.discount_reduction` - the money a discount took off the whole line, in the
 * line's own currency.
 *
 * A discounted line stores the snapshot of the rule that applied, and the rule alone cannot say
 * what it was worth: it carries `percent, 12` and not the `product_price.min_price` floor the
 * reduction may have been clamped to. The figure is therefore resolved once, when the document is
 * raised, and frozen here beside the price it came off - which is what lets the totals report a
 * charged amount rather than a quoted one with a flag beside it.
 *
 * `DEFAULT 0` fills the rows already written. That is right for every line carrying no snapshot and
 * understated for the few that do: their reduction was never recorded and cannot be recovered, the
 * floor not being stored anywhere. They keep the snapshot that says a discount applied.
 */
export class OrderLineDiscountReduction1790600000000
	implements MigrationInterface
{
	name = 'OrderLineDiscountReduction1790600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD "discount_reduction" numeric(12,2) NOT NULL DEFAULT '0'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order_line"."discount_reduction" IS 'Money off the whole line, in the line currency'`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD CONSTRAINT "CHK_63448672b165cfbda408b500bd" CHECK ((discount_reduction >= 0))`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP CONSTRAINT "CHK_63448672b165cfbda408b500bd"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP COLUMN "discount_reduction"`,
		);
	}
}
