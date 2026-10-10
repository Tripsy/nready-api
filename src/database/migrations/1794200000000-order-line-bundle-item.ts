import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `order_line.bundle_item_id`, the `product_bundle_item` a component line was taken from, so
 * an editor can read a stored bundle back as the choices that produced it. `SET NULL` on delete:
 * the line outlives the catalog row.
 *
 * Back-filled for component lines already written, by matching the line's variant against the
 * components of its header's bundle. Only an unambiguous match is written - a bundle naming the
 * same variant twice (in the kit and as an extra) leaves its lines null, and the editor falls back
 * to the bundle's defaults for them.
 */
export class OrderLineBundleItem1794200000000 implements MigrationInterface {
	name = 'OrderLineBundleItem1794200000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD "bundle_item_id" integer`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD CONSTRAINT "FK_94764545270d2b42e8f6705c681" FOREIGN KEY ("bundle_item_id") REFERENCES "product_bundle_item"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(`
			UPDATE "order_line" child
			SET "bundle_item_id" = matched.item_id
			FROM (
				SELECT component.id AS line_id, MIN(item.id) AS item_id
				FROM "order_line" component
				INNER JOIN "order_line" header ON header.id = component.parent_id
				INNER JOIN "product_bundle_item" item
					ON item.product_id = header.product_id
					AND item.variant_id = component.variant_id
					AND item.deleted_at IS NULL
				GROUP BY component.id
				HAVING COUNT(item.id) = 1
			) AS matched
			WHERE child.id = matched.line_id
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP CONSTRAINT "FK_94764545270d2b42e8f6705c681"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP COLUMN "bundle_item_id"`,
		);
	}
}
