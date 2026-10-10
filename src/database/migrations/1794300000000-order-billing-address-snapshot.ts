import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Configuration } from '@/config/settings.config';

/**
 * Turns `order.billing_address_id` back into a copy: `order.billing_address`, a client-address
 * snapshot plus the country's ISO 3166-1 alpha-2 code. The order keeps its own billing address,
 * which an operator may correct while it is unbilled without touching the client's address book.
 *
 * Back-filled from the address each order references, its place chain named in the default content
 * language - the language every snapshot is written in. An order whose address was already removed
 * (the key was `SET NULL`) has nothing to copy and stays null.
 *
 * **`down()` restores the reference but not its value**: a snapshot does not say which address
 * book row it came from, and that row may have changed or gone.
 */
export class OrderBillingAddressSnapshot1794300000000
	implements MigrationInterface
{
	name = 'OrderBillingAddressSnapshot1794300000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" ADD "billing_address" jsonb`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order"."billing_address" IS 'Billing address snapshot, editable while the order is unbilled'`,
		);

		// A place's name in the default language, or any name it has
		const nameOf = (alias: string) => `(
			SELECT COALESCE(
				MAX(content.name) FILTER (WHERE content.language = $1),
				MAX(content.name)
			)
			FROM "place_content" content
			WHERE content.place_id = ${alias}.id
		)`;

		await queryRunner.query(
			`
			WITH chain AS (
				SELECT
					o.id AS order_id,
					ca.details AS holder_details,
					ca.notes AS notes,
					a.details AS street,
					a.postal_code AS postal_code,
					city.id AS city_id,
					city.place_type AS city_type,
					parent.id AS parent_id,
					parent.place_type AS parent_type,
					grandparent.id AS grandparent_id,
					grandparent.place_type AS grandparent_type,
					${nameOf('city')} AS city_name,
					${nameOf('parent')} AS parent_name,
					${nameOf('grandparent')} AS grandparent_name,
					city.alpha2_code AS city_code,
					parent.alpha2_code AS parent_code,
					grandparent.alpha2_code AS grandparent_code
				FROM "order" o
				INNER JOIN "client_address" ca ON ca.id = o.billing_address_id
				INNER JOIN "address" a ON a.id = ca.address_id
				LEFT JOIN "place" city ON city.id = a.city_id
				LEFT JOIN "place" parent ON parent.id = city.parent_id
				LEFT JOIN "place" grandparent ON grandparent.id = parent.parent_id
			)
			UPDATE "order" o
			SET "billing_address" = jsonb_build_object(
				'details', NULLIF(CONCAT_WS(', ', chain.street, chain.holder_details), ''),
				'postal_code', chain.postal_code,
				'address_city', CASE
					WHEN chain.city_type = 'city' THEN chain.city_name
				END,
				'address_region', CASE
					WHEN chain.parent_type = 'region' THEN chain.parent_name
					WHEN chain.grandparent_type = 'region' THEN chain.grandparent_name
				END,
				'address_country', CASE
					WHEN chain.parent_type = 'country' THEN chain.parent_name
					WHEN chain.grandparent_type = 'country' THEN chain.grandparent_name
					WHEN chain.city_type = 'country' THEN chain.city_name
				END,
				'country_code', CASE
					WHEN chain.parent_type = 'country' THEN chain.parent_code
					WHEN chain.grandparent_type = 'country' THEN chain.grandparent_code
					WHEN chain.city_type = 'country' THEN chain.city_code
				END,
				'notes', chain.notes
			)
			FROM chain
			WHERE o.id = chain.order_id
			`,
			[Configuration.language()],
		);

		await queryRunner.query(
			`ALTER TABLE "order" DROP CONSTRAINT "FK_5568d3b9ce9f7abeeb37511ecf2"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_billing_address_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" DROP COLUMN "billing_address_id"`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" ADD "billing_address_id" integer`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order"."billing_address_id" IS 'The client address the order is billed to'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_billing_address_id" ON "order" ("billing_address_id")`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ADD CONSTRAINT "FK_5568d3b9ce9f7abeeb37511ecf2" FOREIGN KEY ("billing_address_id") REFERENCES "client_address"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" DROP COLUMN "billing_address"`,
		);
	}
}
