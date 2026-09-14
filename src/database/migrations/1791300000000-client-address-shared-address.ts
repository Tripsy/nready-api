import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a client address point at an existing `address` instead of owning one.
 *
 * `IDX_client_address_address_id` is rebuilt without `UNIQUE`: the same address may now be filed
 * against several clients, or against one client as both billing and delivery. It stays as a plain
 * index because the `RESTRICT` key on `address_id` checks this table whenever an address is deleted.
 *
 * `details` becomes nullable - it now holds the flat, floor or apartment number, which an address
 * with its own street number does not have. The column comments say what both text columns hold.
 *
 * `down()` backfills an empty string into null `details` before restoring `NOT NULL`, and fails on
 * the unique index if any address is by then shared - there is no row to prefer, so it is left to
 * whoever reverts to resolve.
 */
export class ClientAddressSharedAddress1791300000000
	implements MigrationInterface
{
	name = 'ClientAddressSharedAddress1791300000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_address_address_id"`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_address_address_id" ON "client_address" ("address_id")`,
		);

		await queryRunner.query(
			`ALTER TABLE "client_address" ALTER COLUMN "details" DROP NOT NULL`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_address"."details" IS 'Flat, floor or apartment number within the address'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_address"."notes" IS 'Instructions about reaching the address'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`COMMENT ON COLUMN "client_address"."notes" IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "client_address"."details" IS NULL`,
		);

		await queryRunner.query(
			`UPDATE "client_address" SET "details" = '' WHERE "details" IS NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" ALTER COLUMN "details" SET NOT NULL`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_address_address_id"`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_address_address_id" ON "client_address" ("address_id")`,
		);
	}
}
