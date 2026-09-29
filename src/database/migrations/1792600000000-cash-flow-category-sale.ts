import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the revenue category on `cash_flow` from `customer` to `sale`.
 *
 * The other three categories name a counterparty (`vendor`, `insurance`, `taxes`) and this one
 * named the buyer, which read as a second way of saying what the `client` operational record
 * already says. `sale` names the movement instead, and leaves `order` free to mean only the
 * document the money was raised for - `operational_record_type` already spends that word.
 *
 * `RENAME VALUE` rather than the rebuild `1792400000000-invoice-drop-proforma.ts` does: nothing is
 * being removed, so existing rows and the column default carry over untouched - a default holds
 * the enum value itself, not its label, and reads back as `sale` once the label moves.
 */
export class CashFlowCategorySale1792600000000 implements MigrationInterface {
	name = 'CashFlowCategorySale1792600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."cash_flow_category_enum" RENAME VALUE 'customer' TO 'sale'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "public"."cash_flow_category_enum" RENAME VALUE 'sale' TO 'customer'`,
		);
	}
}
