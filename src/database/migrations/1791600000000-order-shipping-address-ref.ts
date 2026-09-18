import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns the addresses on a document from copies into references.
 *
 * `order.billing_details` becomes `order.billing_address_id`, and `order_shipping` gives up its five
 * address columns for `client_address_id`. Both keys are `SET NULL`: a client address is deleted
 * outright, and an order placed against one must not be what stops the client from tidying their
 * address book.
 *
 * `order_shipping.address_data` is the snapshot that used to be taken at checkout, now taken when
 * the shipment is marked `shipped`. Until then the live address is the better answer - a correction
 * before dispatch should reach the parcel - and after it the opposite holds, since re-addressing
 * goods already with the carrier would make the document disagree with where they went.
 *
 * **`down()` restores the columns but not their contents.** What the dropped jsonb and the address
 * columns held is gone, and there is nothing to rebuild them from once the client address they
 * referenced has moved on.
 *
 * The constraint names are the ones TypeORM derives from the entity, so a later
 * `migration:generate` reads them as unchanged.
 */
export class OrderShippingAddressRef1791600000000
	implements MigrationInterface
{
	name = 'OrderShippingAddressRef1791600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order" DROP COLUMN "billing_details"`,
		);
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
			`ALTER TABLE "order_shipping" DROP COLUMN "address_country"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP COLUMN "address_region"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP COLUMN "address_city"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP COLUMN "details"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP COLUMN "postal_code"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "client_address_id" integer`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "address_data" jsonb`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order_shipping"."address_data" IS 'Destination address frozen when the shipment was marked shipped'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_client_address_id" ON "order_shipping" ("client_address_id")`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD CONSTRAINT "FK_e7da08279c6253acac31b87bace" FOREIGN KEY ("client_address_id") REFERENCES "client_address"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP CONSTRAINT "FK_e7da08279c6253acac31b87bace"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_shipping_client_address_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP COLUMN "address_data"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" DROP COLUMN "client_address_id"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "postal_code" character varying`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "details" character varying`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "address_city" character varying`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "address_region" character varying`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD "address_country" character varying`,
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
		await queryRunner.query(
			`ALTER TABLE "order" ADD "billing_details" jsonb`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "order"."billing_details" IS 'Snapshot of the billing client and address at the moment the order was placed'`,
		);
	}
}
