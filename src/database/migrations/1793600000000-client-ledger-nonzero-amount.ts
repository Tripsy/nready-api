import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A ledger entry is a movement of the balance, so one worth nothing is refused: `amount <> 0`.
 * The service already skips them; this holds the line for any other writer.
 *
 * Any zero entry already stored is removed first - it moved nothing, so the balance is unchanged.
 */
export class ClientLedgerNonzeroAmount1793600000000
	implements MigrationInterface
{
	name = 'ClientLedgerNonzeroAmount1793600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DELETE FROM "client_ledger" WHERE "amount" = 0`,
		);

		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "CHK_614d4d375c0768dca19906f16d" CHECK ((amount <> 0))`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "CHK_614d4d375c0768dca19906f16d"`,
		);
	}
}
