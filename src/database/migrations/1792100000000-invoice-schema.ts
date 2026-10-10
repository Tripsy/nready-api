import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives the invoice the three things it needs before a service can be written against it: its own
 * lines, its own totals, and a way to record what settled it.
 *
 * - **Lines and totals.** The table carried neither, so a total could only be re-summed from
 *   `order_line` - which is replaced wholesale while the order is still `pending`, is
 *   soft-deletable, and leaves out shipping entirely, since that money sits on `shipping` rows and
 *   `OrderService.computeTotals` omits it. An issued document has to hold its own figures.
 * - **Numbering.** `ref_code` / `ref_number` / `issued_at` were `NOT NULL` while `status` defaults
 *   to `draft`, so a number was spent the moment a row was created. `document_series` counts
 *   continuously and never releases one, so every abandoned draft cost a fiscal number. They are
 *   nullable now, allocated on the transition to `issued`, and `IDX_invoice_ref` gained the
 *   `ref_number IS NOT NULL` arm that lets several drafts coexist.
 * - **Settlement.** `invoice_payment` allocates a `cash_flow` movement against an invoice. A table
 *   rather than a column because a deposit plus a balance is two movements against one invoice,
 *   one bank transfer can clear several, and a refund is allocated against a credit note.
 *
 * `status` also loses `paid`, `overdue` and `refunded`. The first two are settlement facts, and
 * they split further rather than moving together: how much is settled goes to `payment_status`,
 * while lateness gets its own `overdue_at`, since an invoice can be part paid *and* late and one
 * column would have to report only one of the two. A charge is never "refunded" either - a
 * `credit_note` reverses it.
 *
 * Constraint and index names are the ones `migration:generate` derives from the entities, so a
 * later diff against these tables comes back empty.
 */
export class InvoiceSchema1792100000000 implements MigrationInterface {
	name = 'InvoiceSchema1792100000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await assertInvoiceTableEmpty(
			queryRunner,
			'Cannot run InvoiceSchema1792100000000',
		);

		// Appending is the one enum change Postgres makes in place. A proforma is not a fiscal
		// document and a credit note is a distinct register, so neither may draw from the invoice
		// series
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum" ADD VALUE IF NOT EXISTS 'proforma'`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum" ADD VALUE IF NOT EXISTS 'credit_note'`,
		);

		// INVOICE - numbering
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_ref"`);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "ref_code" DROP NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "ref_number" DROP NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "issued_at" DROP NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_ref" ON "invoice" ("ref_code", "ref_number") WHERE deleted_at IS NULL AND ref_number IS NOT NULL`,
		);

		// INVOICE - status split
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_status_enum" RENAME TO "invoice_status_enum_old"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_status_enum" AS ENUM('draft', 'issued', 'canceled')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "status" TYPE "public"."invoice_status_enum" USING "status"::"text"::"public"."invoice_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "status" SET DEFAULT 'draft'`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_status_enum_old"`);

		await queryRunner.query(
			`CREATE TYPE "public"."invoice_payment_status_enum" AS ENUM('unpaid', 'partial', 'paid')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "payment_status" "public"."invoice_payment_status_enum" NOT NULL DEFAULT 'unpaid'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_payment_status" ON "invoice" ("payment_status")`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "overdue_at" TIMESTAMP`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_overdue_at" ON "invoice" ("overdue_at") WHERE overdue_at IS NOT NULL`,
		);

		// INVOICE - money and the credit-note link
		await queryRunner.query(`ALTER TABLE "invoice" DROP COLUMN "discount"`);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "base_currency"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "currency" character(3) NOT NULL DEFAULT 'RON'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."currency" IS 'Currency the document is issued in'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."exchange_rate" IS 'Exchange rate to the deployment base currency (default 1 = same currency)'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "total_net" numeric(12,2) NOT NULL DEFAULT '0'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."total_net" IS 'Sum of the line nets, after discount, excluding VAT'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "total_discount_reduction" numeric(12,2) NOT NULL DEFAULT '0'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."total_discount_reduction" IS 'Money off across all lines, excluding VAT'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "total_vat" numeric(12,2) NOT NULL DEFAULT '0'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "total_gross" numeric(12,2) NOT NULL DEFAULT '0'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."total_gross" IS 'What the buyer owes: total_net + total_vat'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "seller_details" jsonb`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."seller_details" IS 'Snapshot of the issuer at the moment of issuing the invoice'`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "parent_invoice_id" integer`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_parent_invoice_id" ON "invoice" ("parent_invoice_id") WHERE parent_invoice_id IS NOT NULL`,
		);

		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_f294116b12beccc45f7a41c1ee" CHECK ((total_net >= 0))`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_efa2715c0cc1157c392f107646" CHECK ((total_discount_reduction >= 0))`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_8b3583bd91b9defc2d39f6ed06" CHECK ((total_vat >= 0))`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "CHK_469aaf113e976160b819d6f1cf" CHECK ((total_gross >= 0))`,
		);

		// INVOICE_LINE
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_line_kind_enum" AS ENUM('product', 'shipping', 'adjustment')`,
		);
		await queryRunner.query(
			`CREATE TABLE "invoice_line" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" integer NOT NULL, "kind" "public"."invoice_line_kind_enum" NOT NULL DEFAULT 'product', "order_line_id" integer, "shipping_id" integer, "product_id" integer, "variant_id" integer, "label" character varying NOT NULL, "quantity" numeric(12,2) NOT NULL, "unit_price" numeric(12,2) NOT NULL, "vat_rate" numeric(5,2) NOT NULL, "discount" jsonb, "discount_reduction" numeric(12,2) NOT NULL DEFAULT '0', "line_net" numeric(12,2) NOT NULL, "line_vat" numeric(12,2) NOT NULL, "line_total" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "CHK_204882c6d0a420f02a01079154" CHECK (
	(
		(kind = 'product' AND shipping_id IS NULL)
		OR (kind = 'shipping' AND order_line_id IS NULL)
		OR (kind = 'adjustment' AND order_line_id IS NULL AND shipping_id IS NULL)
	)
), CONSTRAINT "CHK_10e4fed44164dae88fd91875e2" CHECK ((discount_reduction >= 0)), CONSTRAINT "CHK_88af87ae3aa1e7a09facbccb62" CHECK ((vat_rate >= 0)), CONSTRAINT "CHK_3d24410142c56bc2333efca868" CHECK ((unit_price >= 0)), CONSTRAINT "CHK_2c9101507b300b8787e6a8351c" CHECK ((quantity > 0)), CONSTRAINT "PK_112d67e85951a56ee5123e9c803" PRIMARY KEY ("id")); COMMENT ON COLUMN "invoice_line"."label" IS 'What is billed, as it read on the day - name plus any options'; COMMENT ON COLUMN "invoice_line"."unit_price" IS 'Unit price excluding VAT, in the invoice currency'; COMMENT ON COLUMN "invoice_line"."discount" IS 'Array of discount snapshots applied'; COMMENT ON COLUMN "invoice_line"."discount_reduction" IS 'Money off the whole line, excluding VAT'`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice_line" IS 'Stores invoice line items'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_invoice_id" ON "invoice_line" ("invoice_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_order_line_id" ON "invoice_line" ("order_line_id") WHERE order_line_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_shipping_id" ON "invoice_line" ("shipping_id") WHERE shipping_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_product_id" ON "invoice_line" ("product_id") WHERE product_id IS NOT NULL`,
		);

		// INVOICE_PAYMENT
		await queryRunner.query(
			`CREATE TABLE "invoice_payment" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" integer NOT NULL, "cash_flow_id" integer NOT NULL, "amount" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "CHK_388f0505985acccaf83ae26f17" CHECK ((amount > 0)), CONSTRAINT "PK_b63cfba23ecc43531b5c571ffa3" PRIMARY KEY ("id")); COMMENT ON COLUMN "invoice_payment"."amount" IS 'Amount settled, in the invoice currency'`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice_payment" IS 'Settles a cash movement against an invoice, in part or in full'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_payment_invoice_id" ON "invoice_payment" ("invoice_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_payment_cash_flow_id" ON "invoice_payment" ("cash_flow_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_payment_pair" ON "invoice_payment" ("invoice_id", "cash_flow_id") WHERE deleted_at IS NULL`,
		);

		// FOREIGN KEYS
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_a1f7f52f2f9a8a554ee3faa8a4a" FOREIGN KEY ("parent_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" ADD CONSTRAINT "FK_36e6eecdb00b171d90ff63f2d20" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" ADD CONSTRAINT "FK_ccb16e0007d4e59184cc4e22ec4" FOREIGN KEY ("order_line_id") REFERENCES "order_line"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" ADD CONSTRAINT "FK_33823719eba2c83506ff3a79dc9" FOREIGN KEY ("shipping_id") REFERENCES "shipping"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" ADD CONSTRAINT "FK_5dede093a15bc721f40e607fe90" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" ADD CONSTRAINT "FK_81d2720c41ad4d1fdaa78726ff2" FOREIGN KEY ("cash_flow_id") REFERENCES "cash_flow"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
	}

	/**
	 * Refuses rather than destroys. Restoring `ref_number NOT NULL` would fail on any open draft,
	 * `base_currency` cannot be recovered from `currency` once an invoice is issued in anything
	 * but the base, and Postgres cannot drop an enum value, so the document-type swap needs the two
	 * new series gone first.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		await assertInvoiceTableEmpty(
			queryRunner,
			'Cannot revert InvoiceSchema1792100000000',
		);

		const seriesRows: { count: string }[] = await queryRunner.query(
			`SELECT COUNT(*) AS count FROM "document_series" WHERE "document_type" IN ('proforma', 'credit_note')`,
		);

		if (Number(seriesRows[0]?.count ?? 0) > 0) {
			throw new Error(
				'Cannot revert InvoiceSchema1792100000000: document_series rows for "proforma" or "credit_note" exist. Delete them first.',
			);
		}

		await queryRunner.query(
			`ALTER TABLE "invoice_payment" DROP CONSTRAINT "FK_81d2720c41ad4d1fdaa78726ff2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" DROP CONSTRAINT "FK_5dede093a15bc721f40e607fe90"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP CONSTRAINT "FK_33823719eba2c83506ff3a79dc9"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP CONSTRAINT "FK_ccb16e0007d4e59184cc4e22ec4"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP CONSTRAINT "FK_36e6eecdb00b171d90ff63f2d20"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_a1f7f52f2f9a8a554ee3faa8a4a"`,
		);

		await queryRunner.query(`DROP TABLE "invoice_payment"`);
		await queryRunner.query(`DROP TABLE "invoice_line"`);
		await queryRunner.query(`DROP TYPE "public"."invoice_line_kind_enum"`);

		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_469aaf113e976160b819d6f1cf"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_8b3583bd91b9defc2d39f6ed06"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_efa2715c0cc1157c392f107646"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "CHK_f294116b12beccc45f7a41c1ee"`,
		);

		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_parent_invoice_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "parent_invoice_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "seller_details"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "total_gross"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "total_vat"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "total_discount_reduction"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "total_net"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "exchange_rate"`,
		);
		await queryRunner.query(`ALTER TABLE "invoice" DROP COLUMN "currency"`);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD "base_currency" character(3) NOT NULL DEFAULT 'RON'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."base_currency" IS 'Base currency for the invoice'`,
		);
		await queryRunner.query(`ALTER TABLE "invoice" ADD "discount" jsonb`);
		await queryRunner.query(
			`COMMENT ON COLUMN "invoice"."discount" IS 'Array of discount snapshots applied'`,
		);

		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_overdue_at"`);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "overdue_at"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_payment_status"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP COLUMN "payment_status"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."invoice_payment_status_enum"`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."invoice_status_enum_old" AS ENUM('draft', 'issued', 'paid', 'overdue', 'canceled', 'refunded')`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "status" TYPE "public"."invoice_status_enum_old" USING "status"::"text"::"public"."invoice_status_enum_old"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "status" SET DEFAULT 'draft'`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_status_enum"`);
		await queryRunner.query(
			`ALTER TYPE "public"."invoice_status_enum_old" RENAME TO "invoice_status_enum"`,
		);

		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_ref"`);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "issued_at" SET NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "ref_number" SET NOT NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ALTER COLUMN "ref_code" SET NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_ref" ON "invoice" ("ref_code", "ref_number") WHERE deleted_at IS NULL`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum_old" AS ENUM('invoice', 'order', 'grn', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "document_series" ALTER COLUMN "document_type" TYPE "public"."document_series_document_type_enum_old" USING "document_type"::"text"::"public"."document_series_document_type_enum_old"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum_old" RENAME TO "document_series_document_type_enum"`,
		);
	}
}

/**
 * The table has never been written to - the feature is entity-only - so both directions rewrite
 * columns freely. The guard is what keeps that true: it refuses rather than silently dropping a
 * `discount` or `base_currency` somebody started using.
 */
async function assertInvoiceTableEmpty(
	queryRunner: QueryRunner,
	prefix: string,
): Promise<void> {
	const rows: { count: string }[] = await queryRunner.query(
		`SELECT COUNT(*) AS count FROM "invoice"`,
	);

	if (Number(rows[0]?.count ?? 0) > 0) {
		throw new Error(
			`${prefix}: the "invoice" table holds rows. This migration rewrites its columns and would lose them.`,
		);
	}
}
