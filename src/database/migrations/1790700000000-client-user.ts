import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `client.user_id` - the account a client belongs to, when it belongs to one.
 *
 * One account may hold several clients (a person billing privately and through their company), a
 * client is held by at most one account. Nullable: a client typed in from the back office for a
 * phone order, or one no account has claimed, is still a valid counterparty to invoice.
 *
 * The link is what lets checkout refuse a client the caller does not hold, and what lets a review
 * prove a purchase: `order.client_id -> client.user_id` is the only path from an order back to the
 * account that wrote the review.
 *
 * `ON DELETE SET NULL`: a closed account leaves its clients behind as plain counterparties, since
 * the orders and invoices issued against them have to keep resolving.
 *
 * Written by hand, keeping only the statements this change owns. The foreign-key name is
 * TypeORM's own hash of `client_user_id`, kept verbatim so a future generate sees no difference.
 */
export class ClientUser1790700000000 implements MigrationInterface {
	name = 'ClientUser1790700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "client" ADD "user_id" integer`);
		// Serves both "the caller's clients" at checkout and the referencing side of the key, which
		// Postgres does not index on its own. Partial: most clients are held by no account.
		await queryRunner.query(
			`CREATE INDEX "IDX_client_user_id" ON "client" ("user_id") WHERE user_id IS NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "client" ADD CONSTRAINT "FK_f18a6fabea7b2a90ab6bf10a650" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "client" DROP CONSTRAINT "FK_f18a6fabea7b2a90ab6bf10a650"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_client_user_id"`);
		await queryRunner.query(`ALTER TABLE "client" DROP COLUMN "user_id"`);
	}
}
