import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns `order_shipping` into `shipping` - a movement of goods of any kind, not only an order going
 * out.
 *
 * **`scope` is what every other reference now means.** A `delivery` runs warehouse to client
 * address against an order, a `relocation` warehouse to warehouse against a document that has no
 * table yet, and a `return` client address to warehouse against an order. Each end is a typed
 * column with a real key rather than a bare id, so deleting a warehouse is still refused and
 * deleting a client address still nulls what pointed at it.
 *
 * The two CHECK constraints forbid the ends a scope has no use for rather than requiring the ones it
 * needs. That asymmetry is forced by the keys: the client-address columns are `ON DELETE SET NULL`,
 * so a constraint demanding one be present would turn "delete this address" into a violation.
 * `ShippingService` enforces presence when a row is written.
 *
 * **`shipping_line` now names a variant instead of an order line**, because a relocation has no
 * order behind it. What an order still has unshipped is therefore summed per variant across its
 * movements rather than read off a line.
 *
 * The existing rows are carried across as `delivery` - the only scope the system could produce
 * before this - keeping their ids, so anything already pointing at a movement still resolves.
 * `destination_data` inherits the old `address_data`; `pickup_data` stays null even on dispatched
 * rows, since the origin was never captured and the place names behind it cannot be rebuilt in SQL.
 *
 * The constraint names are the ones TypeORM derives from the entity, so a later
 * `migration:generate` reads them as unchanged.
 */
export class ShippingScope1791700000000 implements MigrationInterface {
	name = 'ShippingScope1791700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_scope_enum" AS ENUM('delivery', 'relocation', 'return')`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."order_shipping_status_enum" RENAME TO "shipping_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."order_shipping_method_enum" RENAME TO "shipping_method_enum"`,
		);

		await queryRunner.query(
			`CREATE TABLE "shipping" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "scope" "public"."shipping_scope_enum" NOT NULL, "order_id" integer, "document_ref" integer, "status" "public"."shipping_status_enum" NOT NULL DEFAULT 'pending', "method" "public"."shipping_method_enum" NOT NULL, "carrier_id" integer, "pickup_warehouse_id" integer, "pickup_client_address_id" integer, "destination_warehouse_id" integer, "destination_client_address_id" integer, "pickup_data" jsonb, "destination_data" jsonb, "tracking_number" character varying, "tracking_url" character varying, "vat_rate" numeric(5,2) NOT NULL, "price" numeric(12,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "discount" jsonb, "contact_name" character varying, "contact_phone" character varying, "contact_email" character varying, "shipped_at" TIMESTAMP, "delivered_at" TIMESTAMP, "estimated_delivery_at" TIMESTAMP, "notes" text, CONSTRAINT "CHK_03ba9c2f16356c8226759d98b3" CHECK (
	(
		(scope IN ('delivery', 'return') AND document_ref IS NULL)
		OR
		(scope = 'relocation' AND order_id IS NULL)
	)
), CONSTRAINT "CHK_c69c2794a64252d72854768dce" CHECK (
	(
		(scope = 'delivery' AND pickup_client_address_id IS NULL AND destination_warehouse_id IS NULL)
		OR
		(scope = 'relocation' AND pickup_client_address_id IS NULL AND destination_client_address_id IS NULL)
		OR
		(scope = 'return' AND pickup_warehouse_id IS NULL AND destination_client_address_id IS NULL)
	)
), CONSTRAINT "PK_0dc6ac92ee9cbc2c1611d77804c" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "shipping" IS 'Physical movements of goods: deliveries to a client, relocations between warehouses, and returns'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."document_ref" IS 'Id of the relocation document; no table for it yet, so no key'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."pickup_data" IS 'Origin address frozen when the movement was marked shipped'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."destination_data" IS 'Destination address frozen when the movement was marked shipped'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."currency" IS 'Currency is specific to client'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."exchange_rate" IS 'Exchange rate to invoice base currency (default 1 = same currency)'`,
		);
		await queryRunner.query(
			`COMMENT ON COLUMN "shipping"."discount" IS 'Array of discount snapshots applied'`,
		);

		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_scope" ON "shipping" ("scope")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_order_id" ON "shipping" ("order_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_document_ref" ON "shipping" ("document_ref")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_status" ON "shipping" ("status")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_method" ON "shipping" ("method")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_carrier_id" ON "shipping" ("carrier_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_pickup_warehouse_id" ON "shipping" ("pickup_warehouse_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_pickup_client_address_id" ON "shipping" ("pickup_client_address_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_destination_warehouse_id" ON "shipping" ("destination_warehouse_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_destination_client_address_id" ON "shipping" ("destination_client_address_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_shipping_tracking_number" ON "shipping" ("tracking_number") WHERE deleted_at IS NULL`,
		);

		await queryRunner.query(
			`CREATE TABLE "shipping_line" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "shipping_id" integer NOT NULL, "variant_id" integer NOT NULL, "product_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "CHK_a13de553ea8db2addb25270831" CHECK ((quantity > 0)), CONSTRAINT "PK_890522bfc44a4b6eb7cb1e52609" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "shipping_line" IS 'What physically travels in one movement, by variant and quantity'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_line_variant_id" ON "shipping_line" ("variant_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_line_product_id" ON "shipping_line" ("product_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_shipping_line_unique" ON "shipping_line" ("shipping_id", "variant_id") WHERE deleted_at IS NULL`,
		);

		/*
		 * Carried across before the keys go on, so a row whose warehouse or address has meanwhile
		 * been removed cannot block the copy - there are none today, and a migration that depends on
		 * that staying true is a migration that breaks on the next environment.
		 */
		await queryRunner.query(
			`INSERT INTO "shipping" ("id", "created_at", "updated_at", "deleted_at", "scope", "order_id", "document_ref", "status", "method", "carrier_id", "pickup_warehouse_id", "pickup_client_address_id", "destination_warehouse_id", "destination_client_address_id", "pickup_data", "destination_data", "tracking_number", "tracking_url", "vat_rate", "price", "currency", "exchange_rate", "discount", "contact_name", "contact_phone", "contact_email", "shipped_at", "delivered_at", "estimated_delivery_at", "notes")
			 SELECT "id", "created_at", "updated_at", "deleted_at", 'delivery'::"public"."shipping_scope_enum", "order_id", NULL, "status", "method", "carrier_id", "warehouse_id", NULL, NULL, "client_address_id", NULL, "address_data", "tracking_number", "tracking_url", "vat_rate", "price", "currency", "exchange_rate", "discount", "contact_name", "contact_phone", "contact_email", "shipped_at", "delivered_at", "estimated_delivery_at", "notes"
			 FROM "order_shipping"`,
		);

		/*
		 * The variant comes from the order line the allocation used to name. A line whose order line
		 * has since been hard-deleted has nothing to resolve to and is dropped rather than guessed;
		 * the inner join is what expresses that.
		 *
		 * `DISTINCT ON` keeps the new unique index satisfiable: two allocations of the same variant
		 * within one movement were legal before - they were different order lines - and are one line
		 * now, taking the larger quantity.
		 */
		await queryRunner.query(
			`INSERT INTO "shipping_line" ("created_at", "updated_at", "deleted_at", "shipping_id", "variant_id", "product_id", "quantity", "notes")
			 SELECT DISTINCT ON (l."order_shipping_id", o."variant_id")
			        l."created_at", l."updated_at", l."deleted_at", l."order_shipping_id", o."variant_id", o."product_id", l."quantity", l."notes"
			 FROM "order_shipping_line" l
			 INNER JOIN "order_line" o ON o."id" = l."order_line_id"
			 ORDER BY l."order_shipping_id", o."variant_id", l."quantity" DESC`,
		);

		// The copies kept their ids, so the sequence has to be moved past them or the next insert
		// collides with a migrated row
		await queryRunner.query(
			`SELECT setval(pg_get_serial_sequence('shipping', 'id'), GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "shipping"), 1))`,
		);
		await queryRunner.query(
			`SELECT setval(pg_get_serial_sequence('shipping_line', 'id'), GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "shipping_line"), 1))`,
		);

		await queryRunner.query(
			`ALTER TABLE "shipping" ADD CONSTRAINT "FK_a37456893780ce2dfe0a7484c22" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ADD CONSTRAINT "FK_d69b5df160de61199dcc793d3ee" FOREIGN KEY ("carrier_id") REFERENCES "carrier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ADD CONSTRAINT "FK_d4cff73dcaa06e959cce8295816" FOREIGN KEY ("pickup_warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ADD CONSTRAINT "FK_8cd14c6bba09f1f387c7b94976c" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ADD CONSTRAINT "FK_bd7ae170286f40bb04c2b261640" FOREIGN KEY ("pickup_client_address_id") REFERENCES "client_address"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" ADD CONSTRAINT "FK_881e1fddbdfd46691d6c1cd49e6" FOREIGN KEY ("destination_client_address_id") REFERENCES "client_address"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" ADD CONSTRAINT "FK_de29bf9df8e9e33b4a69495c0e0" FOREIGN KEY ("shipping_id") REFERENCES "shipping"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" ADD CONSTRAINT "FK_86ae0066a568d3f46f4633f0d6b" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);

		await queryRunner.query(`DROP TABLE "order_shipping_line"`);
		await queryRunner.query(`DROP TABLE "order_shipping"`);

		// The stock ledger names the table an outbound movement came from, so the label moves with it
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_source"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."warehouse_movement_source_type_enum" RENAME TO "warehouse_movement_source_type_enum_old"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."warehouse_movement_source_type_enum" AS ENUM('grn_item', 'shipping_line', 'adjustment')`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" ALTER COLUMN "source_type" TYPE "public"."warehouse_movement_source_type_enum" USING REPLACE("source_type"::"text", 'order_shipping_line', 'shipping_line')::"public"."warehouse_movement_source_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."warehouse_movement_source_type_enum_old"`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_movement_source" ON "warehouse_movement" ("source_type", "source_id")`,
		);
	}

	/**
	 * Rebuilds the order-shaped tables and carries the deliveries back.
	 *
	 * **A `relocation` or a `return` cannot be represented in the old shape at all** - it has no
	 * order, and the old table's `order_id` is `NOT NULL` - so those rows are dropped rather than
	 * mangled into something an order-only reader would misread. The line allocation cannot be
	 * rebuilt either: a variant does not say which order line it satisfied.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_source"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."warehouse_movement_source_type_enum" RENAME TO "warehouse_movement_source_type_enum_old"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."warehouse_movement_source_type_enum" AS ENUM('grn_item', 'order_shipping_line', 'adjustment')`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" ALTER COLUMN "source_type" TYPE "public"."warehouse_movement_source_type_enum" USING REPLACE("source_type"::"text", 'shipping_line', 'order_shipping_line')::"public"."warehouse_movement_source_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."warehouse_movement_source_type_enum_old"`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_movement_source" ON "warehouse_movement" ("source_type", "source_id")`,
		);

		await queryRunner.query(
			`ALTER TYPE "public"."shipping_status_enum" RENAME TO "order_shipping_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TYPE "public"."shipping_method_enum" RENAME TO "order_shipping_method_enum"`,
		);

		await queryRunner.query(
			`CREATE TABLE "order_shipping" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "order_id" integer NOT NULL, "status" "public"."order_shipping_status_enum" NOT NULL DEFAULT 'pending', "method" "public"."order_shipping_method_enum" NOT NULL, "carrier_id" integer, "warehouse_id" integer NOT NULL, "client_address_id" integer, "address_data" jsonb, "tracking_number" character varying, "tracking_url" character varying, "vat_rate" numeric(5,2) NOT NULL, "price" numeric(12,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "discount" jsonb, "contact_name" character varying, "contact_phone" character varying, "contact_email" character varying, "shipped_at" TIMESTAMP, "delivered_at" TIMESTAMP, "estimated_delivery_at" TIMESTAMP, "notes" text, CONSTRAINT "PK_9e1174bf865646026aba95d2ae0" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE TABLE "order_shipping_line" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "order_line_id" integer NOT NULL, "order_shipping_id" integer NOT NULL, "quantity" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "CHK_2feff637a0261c3886c368ed6d" CHECK ((quantity > 0)), CONSTRAINT "PK_07c1c05392d97859bb43947dfc7" PRIMARY KEY ("id"))`,
		);

		await queryRunner.query(
			`INSERT INTO "order_shipping" ("id", "created_at", "updated_at", "deleted_at", "order_id", "status", "method", "carrier_id", "warehouse_id", "client_address_id", "address_data", "tracking_number", "tracking_url", "vat_rate", "price", "currency", "exchange_rate", "discount", "contact_name", "contact_phone", "contact_email", "shipped_at", "delivered_at", "estimated_delivery_at", "notes")
			 SELECT "id", "created_at", "updated_at", "deleted_at", "order_id", "status", "method", "carrier_id", "pickup_warehouse_id", "destination_client_address_id", "destination_data", "tracking_number", "tracking_url", "vat_rate", "price", "currency", "exchange_rate", "discount", "contact_name", "contact_phone", "contact_email", "shipped_at", "delivered_at", "estimated_delivery_at", "notes"
			 FROM "shipping"
			 WHERE "scope" = 'delivery' AND "order_id" IS NOT NULL AND "pickup_warehouse_id" IS NOT NULL`,
		);
		await queryRunner.query(
			`SELECT setval(pg_get_serial_sequence('order_shipping', 'id'), GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "order_shipping"), 1))`,
		);

		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_order_id" ON "order_shipping" ("order_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_status" ON "order_shipping" ("status")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_method" ON "order_shipping" ("method")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_carrier_id" ON "order_shipping" ("carrier_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_warehouse_id" ON "order_shipping" ("warehouse_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_client_address_id" ON "order_shipping" ("client_address_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_shipping_tracking_number" ON "order_shipping" ("tracking_number") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_shipping_line_order_line_id" ON "order_shipping_line" ("order_line_id")`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_shipping_line_unique" ON "order_shipping_line" ("order_shipping_id", "order_line_id") WHERE deleted_at IS NULL`,
		);

		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD CONSTRAINT "FK_b4a21d5bd902c38f79c019fbe99" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD CONSTRAINT "FK_888c5cf82dd082363ab0b8c1987" FOREIGN KEY ("carrier_id") REFERENCES "carrier"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD CONSTRAINT "FK_f6a6001df2493e4a766f920e24d" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping" ADD CONSTRAINT "FK_e7da08279c6253acac31b87bace" FOREIGN KEY ("client_address_id") REFERENCES "client_address"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" ADD CONSTRAINT "FK_81e278ef1dcae55494ba16d917c" FOREIGN KEY ("order_shipping_id") REFERENCES "order_shipping"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_shipping_line" ADD CONSTRAINT "FK_91df41bc0968ff982d1d464512b" FOREIGN KEY ("order_line_id") REFERENCES "order_line"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);

		await queryRunner.query(`DROP TABLE "shipping_line"`);
		await queryRunner.query(`DROP TABLE "shipping"`);
		await queryRunner.query(`DROP TYPE "public"."shipping_scope_enum"`);
	}
}
