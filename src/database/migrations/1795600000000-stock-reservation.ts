import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `stock_reservation`: units promised to an order not yet shipped, per variant. Available stock is
 * on hand across active warehouses minus what live orders reserve - see
 * `stock-reservation.entity.ts`.
 *
 * Orders placed before this table existed hold no rows; the `warehouse-movement` demo seed (and
 * `WarehouseMovementService.backfill`) restates them.
 */
export class StockReservation1795600000000 implements MigrationInterface {
	name = 'StockReservation1795600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "stock_reservation" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "order_id" integer NOT NULL, "variant_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL, CONSTRAINT "CHK_1b07e88213a2fde09e0cfa477a" CHECK ((quantity > 0)), CONSTRAINT "PK_a1f7c9841feb7e5744923efa2d2" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_stock_reservation_variant_id" ON "stock_reservation"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_stock_reservation_unique" ON "stock_reservation"  ("order_id", "variant_id") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "stock_reservation" IS 'Units promised to orders not yet shipped; available = on hand - reserved, per variant'`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" ADD CONSTRAINT "FK_9a5c151a1eb06bfb35e07649cee" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" ADD CONSTRAINT "FK_0b7592b1107e4088a2a173f77ef" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" DROP CONSTRAINT "FK_0b7592b1107e4088a2a173f77ef"`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" DROP CONSTRAINT "FK_9a5c151a1eb06bfb35e07649cee"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "stock_reservation" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_stock_reservation_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_stock_reservation_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "stock_reservation"`);
	}
}
