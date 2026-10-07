import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Typed invoices, reversals as a flag, and the client ledger.
 *
 * - `invoice.type` becomes `order | shipping | subscription`. Every existing `charge` is an
 *   `order` document: it billed an order's goods (and, before this, its shipping too - those
 *   documents keep their shipping lines, the split applies to new documents only).
 * - `invoice.is_reversal`: an existing `credit_note` becomes a reversal carrying its parent's
 *   type. Its lines are matched back to the parent lines they mirrored, into
 *   `invoice_line.parent_line_id`.
 * - `invoice.client_id`, backfilled from the order, else from the client the allocated movement
 *   was filed under, else from the parent document of a credit note. A document none of those
 *   name stops the migration rather than being guessed at.
 * - `invoice.subscription_id`, a bare id with no key - see the entity.
 * - `client_ledger`, empty here: `client-ledger-reconcile.cron.ts` (or `pnpm run seed
 *   client-ledger`) writes the entries the existing documents and movements imply.
 *
 * `down()` maps every original back to `charge` and every reversal back to `credit_note`, which
 * loses the type distinction.
 */
export class InvoiceTypesClientLedger1792900000000
	implements MigrationInterface
{
	name = 'InvoiceTypesClientLedger1792900000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// invoice.is_reversal, read off the old type before it goes
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "is_reversal" boolean NOT NULL DEFAULT false`,
		);
		await queryRunner.query(
			`UPDATE "invoice" SET "is_reversal" = true WHERE "type" = 'credit_note'`,
		);

		/*
		 * invoice.type - through text, because a reversal takes its parent's new type and a cast
		 * expression cannot read another row
		 */
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE text`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_type_enum"`);
		await queryRunner.query(
			`UPDATE "invoice" SET "type" = 'order' WHERE "type" = 'charge'`,
		);
		await queryRunner.query(`
			UPDATE "invoice" SET "type" = "parent"."type"
			FROM "invoice" "parent"
			WHERE "invoice"."type" = 'credit_note'
				AND "invoice"."parent_invoice_id" = "parent"."id"
		`);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_type_enum" AS ENUM('order', 'shipping', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE "public"."invoice_type_enum" USING "type"::"public"."invoice_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" SET DEFAULT 'order'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_484126b8280d68d154eafbc18b" CHECK ((is_reversal = (parent_invoice_id IS NOT NULL)))`,
		);

		// invoice_line.parent_line_id - a reversal line mirrored its parent line field for field
		await queryRunner.query(
			`ALTER TABLE "invoice_line" ADD "parent_line_id" integer`,
		);
		await queryRunner.query(`
			UPDATE "invoice_line" SET "parent_line_id" = "match"."parent_id"
			FROM (
				SELECT DISTINCT ON ("child"."id") "child"."id" AS "child_id", "parent"."id" AS "parent_id"
				FROM "invoice_line" "child"
				INNER JOIN "invoice" "reversal"
					ON "reversal"."id" = "child"."invoice_id" AND "reversal"."is_reversal" = true
				INNER JOIN "invoice_line" "parent"
					ON "parent"."invoice_id" = "reversal"."parent_invoice_id"
					AND "parent"."kind" = "child"."kind"
					AND "parent"."order_line_id" IS NOT DISTINCT FROM "child"."order_line_id"
					AND "parent"."shipping_id" IS NOT DISTINCT FROM "child"."shipping_id"
					AND "parent"."label" = "child"."label"
				ORDER BY "child"."id", "parent"."id"
			) "match"
			WHERE "invoice_line"."id" = "match"."child_id"
		`);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_parent_line_id" ON "invoice_line" ("parent_line_id") WHERE parent_line_id IS NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" ADD CONSTRAINT "FK_80102d263c514a8516640264744" FOREIGN KEY ("parent_line_id") REFERENCES "invoice_line"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);

		// invoice.client_id
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "client_id" integer`,
		);
		await queryRunner.query(
			`UPDATE "invoice" SET "client_id" = "order"."client_id" FROM "order" WHERE "invoice"."order_id" = "order"."id"`,
		);
		await queryRunner.query(`
			UPDATE "invoice" SET "client_id" = "operational_record"."entity_id"
			FROM "invoice_payment"
			INNER JOIN "operational_record"
				ON "operational_record"."cash_flow_id" = "invoice_payment"."cash_flow_id"
				AND "operational_record"."operational_record_type" = 'client'
				AND "operational_record"."deleted_at" IS NULL
			WHERE "invoice"."client_id" IS NULL
				AND "invoice_payment"."invoice_id" = "invoice"."id"
		`);
		await queryRunner.query(`
			UPDATE "invoice" SET "client_id" = "parent"."client_id"
			FROM "invoice" "parent"
			WHERE "invoice"."client_id" IS NULL
				AND "invoice"."parent_invoice_id" = "parent"."id"
		`);

		const orphans: { count: string }[] = await queryRunner.query(
			`SELECT COUNT(*) AS "count" FROM "invoice" WHERE "client_id" IS NULL`,
		);

		if (Number(orphans[0]?.count ?? 0) > 0) {
			throw new Error(
				`${orphans[0]?.count} invoice(s) name no order, no allocated client movement and no parent - set invoice.client_id by hand and run again`,
			);
		}

		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "client_id" SET NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_c2dcbb1f285e8b596858aceb923" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_client_settlement" ON "invoice" ("client_id", "status", "payment_status") WHERE is_reversal = false`,
		);

		// invoice.subscription_id
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "subscription_id" integer`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."subscription_id" IS 'Id of the subscription billed; no key, see the entity'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_subscription_id" ON "invoice" ("subscription_id") WHERE subscription_id IS NOT NULL`,
		);

		await queryRunner.query(`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_a351634101d40e267e11b9c804" CHECK (
	(
		(type = 'shipping' AND order_id IS NOT NULL)
		OR (type = 'subscription' AND subscription_id IS NOT NULL)
		OR type = 'order'
	)
)`);

		// client_ledger
		await queryRunner.query(
			`CREATE TYPE "public"."client_ledger_entry_type_enum" AS ENUM('invoice', 'reversal', 'invoice_cancel', 'payment', 'refund')`,
		);
		await queryRunner.query(`CREATE TABLE "client_ledger" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "client_id" integer NOT NULL, "entry_type" "public"."client_ledger_entry_type_enum" NOT NULL, "invoice_id" integer, "cash_flow_id" integer, "currency" character(3) NOT NULL, "amount" numeric(12,2) NOT NULL, "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "amount_base" numeric(14,2) NOT NULL, "occurred_at" TIMESTAMP NOT NULL, CONSTRAINT "CHK_8aa451df0c927056ba4aae12a9" CHECK (
	(
		(entry_type IN ('invoice', 'reversal', 'invoice_cancel') AND invoice_id IS NOT NULL AND cash_flow_id IS NULL)
		OR (entry_type IN ('payment', 'refund') AND cash_flow_id IS NOT NULL AND invoice_id IS NULL)
	)
), CONSTRAINT "PK_b2ac9f0b0e7ef2e7fb6da288e0b" PRIMARY KEY ("id")); COMMENT ON COLUMN "client_ledger"."currency" IS 'Currency of the source document or movement'; COMMENT ON COLUMN "client_ledger"."amount" IS 'Positive: the client owes it; negative: the business owes it'; COMMENT ON COLUMN "client_ledger"."exchange_rate" IS 'Rate to the deployment base currency, frozen from the source row'; COMMENT ON COLUMN "client_ledger"."amount_base" IS 'amount * exchange_rate, in the deployment base currency'; COMMENT ON COLUMN "client_ledger"."occurred_at" IS 'When the document was issued or the money moved'`);
		await queryRunner.query(
			`COMMENT ON TABLE "client_ledger" IS 'Append-only record of what each client owes or holds, per currency'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_ledger_cash_flow_id" ON "client_ledger" ("cash_flow_id") WHERE cash_flow_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_ledger_cash_flow" ON "client_ledger" ("entry_type", "cash_flow_id") WHERE cash_flow_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_ledger_invoice" ON "client_ledger" ("entry_type", "invoice_id") WHERE invoice_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_ledger_client_currency" ON "client_ledger" ("client_id", "currency", "occurred_at")`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "FK_ffdce5dc3204f23722ddf97c912" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "FK_40b5662709dad4ee2338968bf3d" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "FK_a9d41061b39e0be6044df6bd6da" FOREIGN KEY ("cash_flow_id") REFERENCES "cash_flow"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "client_ledger"`);
		await queryRunner.query(
			`DROP TYPE "public"."client_ledger_entry_type_enum"`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_a351634101d40e267e11b9c804"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_subscription_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "subscription_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_client_settlement"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_c2dcbb1f285e8b596858aceb923"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "client_id"`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP CONSTRAINT "FK_80102d263c514a8516640264744"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_line_parent_line_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP COLUMN "parent_line_id"`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_484126b8280d68d154eafbc18b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE text`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_type_enum"`);
		await queryRunner.query(
			`UPDATE "invoice" SET "type" = CASE WHEN "is_reversal" THEN 'credit_note' ELSE 'charge' END`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_type_enum" AS ENUM('charge', 'credit_note')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" TYPE "public"."invoice_type_enum" USING "type"::"public"."invoice_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "type" SET DEFAULT 'charge'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "is_reversal"`,
		);
	}
}
