import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `client_address` - an `address` filed against a client as billing or delivery.
 *
 * No `deleted_at`: the table has no restore, so a removed row is deleted outright. `address_id` is
 * unique because each address row belongs to one client address, and `RESTRICT` means the address
 * is removed after the row that holds it. `client_id` cascades, which only acts on a hard delete of
 * the client - its usual soft delete fires nothing.
 *
 * The constraint names are the ones TypeORM derives from the entity, so a later
 * `migration:generate` reads them as unchanged.
 */
export class ClientAddress1791200000000 implements MigrationInterface {
	name = 'ClientAddress1791200000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."client_address_type_enum" AS ENUM('billing', 'delivery')`,
		);
		await queryRunner.query(
			`CREATE TABLE "client_address" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "client_id" integer NOT NULL, "address_id" integer NOT NULL, "type" "public"."client_address_type_enum" NOT NULL, "details" text NOT NULL, "notes" text, CONSTRAINT "PK_fea7ca529948e3e15c4f91b37fc" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_address_address_id" ON "client_address" ("address_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_address_client_id" ON "client_address" ("client_id", "type")`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "client_address" IS 'Billing and delivery addresses held by a client'`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" ADD CONSTRAINT "FK_3d8c00d2213b8fdefc2d18a11de" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" ADD CONSTRAINT "FK_5d748613d45a8988c741592de72" FOREIGN KEY ("address_id") REFERENCES "address"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// Dropping the table drops its indexes and constraints with it; the enum type is separate
		await queryRunner.query(`DROP TABLE "client_address"`);
		await queryRunner.query(
			`DROP TYPE "public"."client_address_type_enum"`,
		);
	}
}
