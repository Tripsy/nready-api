import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Returns: the `order_return` authorization and its lines, the `order_return` document series
 * type, and `shipping_line.condition` - what a returned unit is fit for, which decides whether it
 * is restocked or written off.
 *
 * The series enum is rebuilt rather than extended with `ADD VALUE`, the way earlier series
 * migrations change it: a value added in place cannot be used until its transaction commits.
 */
export class OrderReturn1795700000000 implements MigrationInterface {
	name = 'OrderReturn1795700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_line_condition_enum" AS ENUM('resellable', 'damaged')`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" ADD "condition" "public"."shipping_line_condition_enum"`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping_line"."condition" IS 'What a returned unit is fit for; return movements only'`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum_new" AS ENUM('invoice', 'order', 'grn', 'subscription', 'order_return')`,
		);
		await queryRunner.query(
			`ALTER TABLE "document_series" ALTER COLUMN "document_type" TYPE "public"."document_series_document_type_enum_new" USING "document_type"::text::"public"."document_series_document_type_enum_new"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum_new" RENAME TO "document_series_document_type_enum"`,
		);

		await queryRunner.query(
			`CREATE TYPE "public"."order_return_status_enum" AS ENUM('requested', 'approved', 'rejected', 'received', 'closed', 'canceled')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_return_reason_enum" AS ENUM('damaged', 'defective', 'wrong_item', 'not_as_described', 'no_longer_needed', 'other')`,
		);
		await queryRunner.query(
			`CREATE TABLE "order_return" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "ref_code" character varying(10) NOT NULL, "ref_number" integer NOT NULL, "status" "public"."order_return_status_enum" NOT NULL DEFAULT 'requested', "reason" "public"."order_return_reason_enum" NOT NULL, "customer_notes" text, "response" text, "decided_at" TIMESTAMP, "received_at" TIMESTAMP, "closed_at" TIMESTAMP, "reversal_invoice_ids" integer array NOT NULL DEFAULT '{}', "notes" text, "order_id" integer NOT NULL, "shipping_id" integer, "user_id" integer, CONSTRAINT "PK_36413fb3df0d9d66ae67cbdcb9a" PRIMARY KEY ("id")); COMMENT ON COLUMN "order_return"."ref_code" IS 'Series code allocated from document_series, e.g. RMA'; COMMENT ON COLUMN "order_return"."ref_number" IS 'Sequential number within the series'; COMMENT ON COLUMN "order_return"."customer_notes" IS 'What the buyer wrote with the request'; COMMENT ON COLUMN "order_return"."response" IS 'What the buyer is told about the decision'; COMMENT ON COLUMN "order_return"."decided_at" IS 'When it was approved or rejected'; COMMENT ON COLUMN "order_return"."received_at" IS 'When the return movement reached its warehouse'; COMMENT ON COLUMN "order_return"."reversal_invoice_ids" IS 'Draft reversals raised for the returned goods; no FK, an array cannot carry one'; COMMENT ON COLUMN "order_return"."notes" IS 'Internal, never shown to the buyer'; COMMENT ON COLUMN "order_return"."shipping_id" IS 'The return movement, once approved'; COMMENT ON COLUMN "order_return"."user_id" IS 'The account that asked; null when raised in the back office'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_user_id" ON "order_return" ("user_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_return_shipping_id" ON "order_return" ("shipping_id") WHERE shipping_id IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_status" ON "order_return" ("status")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_order_status" ON "order_return" ("order_id", "status")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_return_ref" ON "order_return" ("ref_code", "ref_number") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_return" IS 'Return authorizations: a request to send goods back, and the decision on it'`,
		);

		await queryRunner.query(
			`CREATE TABLE "order_return_line" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "order_return_id" integer NOT NULL, "variant_id" integer NOT NULL, "product_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL, CONSTRAINT "CHK_391c0a525b5a6375d86ca36ed8" CHECK ((quantity > 0)), CONSTRAINT "PK_49402b020a9dc896bfb025a1257" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_line_variant_id" ON "order_return_line" ("variant_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_return_line_unique" ON "order_return_line" ("order_return_id", "variant_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_return_line" IS 'What a return asks to send back, by variant and quantity'`,
		);

		await queryRunner.query(
			`ALTER TABLE "order_return" ADD CONSTRAINT "FK_f2c6ae4d507d369652bbe6e4a04" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return" ADD CONSTRAINT "FK_6026be6cb11ad737782f5f720aa" FOREIGN KEY ("shipping_id") REFERENCES "shipping"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return" ADD CONSTRAINT "FK_bedde5994142b88558a0dd95bca" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return_line" ADD CONSTRAINT "FK_66581b540faf934d9e2b84a866b" FOREIGN KEY ("order_return_id") REFERENCES "order_return"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return_line" ADD CONSTRAINT "FK_4caaf0fd5b76203af0609a8896f" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "order_return_line"`);
		await queryRunner.query(`DROP TABLE "order_return"`);
		await queryRunner.query(
			`DROP TYPE "public"."order_return_reason_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."order_return_status_enum"`,
		);

		// Only an unused series row goes. One that handed out numbers stays, and the cast below then
		// fails on it - spent numbers are part of the books
		await queryRunner.query(
			`DELETE FROM "document_series" WHERE "document_type" = 'order_return' AND "next_number" = "start_number"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum_old" AS ENUM('invoice', 'order', 'grn', 'subscription')`,
		);
		await queryRunner.query(
			`ALTER TABLE "document_series" ALTER COLUMN "document_type" TYPE "public"."document_series_document_type_enum_old" USING "document_type"::text::"public"."document_series_document_type_enum_old"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."document_series_document_type_enum_old" RENAME TO "document_series_document_type_enum"`,
		);

		await queryRunner.query(
			`ALTER TABLE "shipping_line" DROP COLUMN "condition"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."shipping_line_condition_enum"`,
		);
	}
}
