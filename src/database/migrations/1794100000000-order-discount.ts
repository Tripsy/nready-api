import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `order.discount`, the snapshot of an operator's order-wide discount. The money it took off
 * stays apportioned on the lines; the snapshot's `reduction` is their sum.
 *
 * Back-filled from the line snapshots, where it was recorded only as per-line shares before this
 * column: every line carried a `manual` share with scope `order`, so the first one supplies the
 * snapshot and the shares summed supply its `reduction`. `down` drops the column; the shares stay
 * on the lines, so nothing is lost.
 */
export class OrderDiscount1794100000000 implements MigrationInterface {
	name = 'OrderDiscount1794100000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "order" ADD "discount" jsonb`);
		await queryRunner.query(
			`COMMENT ON COLUMN "order"."discount" IS 'Order-wide manual discount snapshot'`,
		);
		await queryRunner.query(`
			WITH shares AS (
				SELECT ol.order_id, ol.id AS line_id, snapshot
				FROM "order_line" ol
				CROSS JOIN LATERAL jsonb_array_elements(ol.discount) AS snapshot
				WHERE jsonb_typeof(ol.discount) = 'array'
					AND snapshot->>'manual' = 'true'
					AND snapshot->>'scope' = 'order'
			),
			found AS (
				SELECT DISTINCT ON (order_id)
					order_id,
					snapshot,
					SUM(COALESCE((snapshot->>'reduction')::numeric, 0))
						OVER (PARTITION BY order_id) AS reduction
				FROM shares
				ORDER BY order_id, line_id
			)
			UPDATE "order" o
			SET "discount" = jsonb_set(
				found.snapshot,
				'{reduction}',
				to_jsonb(ROUND(found.reduction, 2))
			)
			FROM found
			WHERE o.id = found.order_id
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "discount"`);
	}
}
