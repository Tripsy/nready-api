import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `stock_adjustment` - stock added or removed by hand, for a stated reason. Its
 * `warehouse_movement` rows use the existing `adjustment` source with `source_id` pointing here,
 * so the ledger itself does not change.
 *
 * Trimmed from a generated diff: the generator also proposed dropping `document_series.padding`
 * and `format` and renaming several hand-named foreign keys, drift that belongs to the planned
 * consolidation rather than to this table.
 */
export class StockAdjustment1795900000000 implements MigrationInterface {
	name = 'StockAdjustment1795900000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."stock_adjustment_reason_enum" AS ENUM('audit', 'damaged', 'expired', 'lost', 'theft', 'sample', 'found', 'sample_returned', 'return')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."stock_adjustment_status_enum" AS ENUM('created', 'reversed')`,
		);
		// The check is the entity's text verbatim - TypeORM names a check by hashing it
		await queryRunner.query(
			`CREATE TABLE "stock_adjustment" (
				"id" SERIAL NOT NULL,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP DEFAULT now(),
				"deleted_at" TIMESTAMP,
				"reason" "public"."stock_adjustment_reason_enum" NOT NULL,
				"qty" numeric(12,2) NOT NULL,
				"status" "public"."stock_adjustment_status_enum" NOT NULL DEFAULT 'created',
				"reversed_at" TIMESTAMP,
				"notes" text,
				"warehouse_id" integer NOT NULL,
				"variant_id" integer NOT NULL,
				CONSTRAINT "CHK_ef13fdabf037f2316b12b895b6" CHECK (
	(
		(qty < 0 AND reason IN ('audit', 'damaged', 'expired', 'lost', 'theft', 'sample'))
		OR
		(qty > 0 AND reason IN ('audit', 'found', 'sample_returned', 'return'))
	)
),
				CONSTRAINT "PK_a140820a147913d91b4eb3b7e27" PRIMARY KEY ("id")
			)`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "stock_adjustment"."qty" IS 'Signed change posted to the lots; positive adds, negative removes'`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "stock_adjustment" IS 'Stock added or removed by hand, with a reason; its warehouse_movement rows point back here'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_stock_adjustment_variant_id" ON "stock_adjustment" ("variant_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_stock_adjustment_warehouse_variant" ON "stock_adjustment" ("warehouse_id", "variant_id")`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_adjustment" ADD CONSTRAINT "FK_c51e024f2f3111a18d88bdfdaf4" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_adjustment" ADD CONSTRAINT "FK_3a5138201295e437439d9ed0dcd" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "stock_adjustment"`);
		await queryRunner.query(
			`DROP TYPE "public"."stock_adjustment_status_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."stock_adjustment_reason_enum"`,
		);
	}
}
