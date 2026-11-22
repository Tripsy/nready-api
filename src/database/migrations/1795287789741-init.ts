import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1795287789741 implements MigrationInterface {
	name = 'Init1795287789741';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "address" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "city_id" uuid, "details" text NOT NULL, "postal_code" character varying, CONSTRAINT "PK_d92de1f82754668b5f5f5dd4fd5" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_address_city_id" ON "address"  ("city_id") `,
		);
		await queryRunner.query(`COMMENT ON TABLE "address" IS 'Addresses'`);
		await queryRunner.query(
			`CREATE TYPE "public"."article_status_enum" AS ENUM('draft', 'pending', 'rejected', 'scheduled', 'published', 'archived')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."article_layout_enum" AS ENUM('default')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."article_featured_status_enum" AS ENUM('section', 'category')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."article_visibility_enum" AS ENUM('public', 'restricted')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."article_source_mode_enum" AS ENUM('input', 'parsed')`,
		);
		await queryRunner.query(
			`CREATE TABLE "article" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "status" "public"."article_status_enum" NOT NULL DEFAULT 'draft', "layout" "public"."article_layout_enum" NOT NULL DEFAULT 'default', "details" jsonb, "publish_at" TIMESTAMP, "archive_at" TIMESTAMP, "featured_status" "public"."article_featured_status_enum", "featured_order" integer NOT NULL DEFAULT '0', "featured_expire_at" TIMESTAMP, "visibility" "public"."article_visibility_enum" NOT NULL DEFAULT 'public', "public_at" TIMESTAMP, "source_mode" "public"."article_source_mode_enum" NOT NULL DEFAULT 'input', "source" jsonb, "author_id" uuid, CONSTRAINT "PK_40808690eb7b915046558c0f81b" PRIMARY KEY ("id")); COMMENT ON COLUMN "article"."details" IS 'Free-form article data; the \`allow_rating\` / \`allow_comments\` / \`allow_complaints\` keys hold the per-article overrides of the deployment defaults'; COMMENT ON COLUMN "article"."publish_at" IS 'Controls when the article should be displayed'; COMMENT ON COLUMN "article"."archive_at" IS 'Controls when the article should transition to archived'; COMMENT ON COLUMN "article"."featured_order" IS 'Order/position of the article within the featured group; Relevant only when featured_status is set'; COMMENT ON COLUMN "article"."featured_expire_at" IS 'Controls when featured_status should be cleared; Relevant only when featured_status is set'; COMMENT ON COLUMN "article"."public_at" IS 'Controls when the article with restricted visibility should transition to public'; COMMENT ON COLUMN "article"."source" IS 'Source attribution for display (label, url, disclaimer, about)'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_author_id" ON "article"  ("author_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_public_at" ON "article"  ("public_at") WHERE public_at IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_archive_at" ON "article"  ("archive_at") WHERE archive_at IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_featured" ON "article"  ("featured_status", "featured_order") WHERE featured_status IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_status_publish_at" ON "article"  ("status", "publish_at") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "article" IS 'Stores core article information; textual content is saved in article-content.entity'`,
		);
		await queryRunner.query(
			`CREATE TABLE "article_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "article_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "slug" character varying NOT NULL, "author" jsonb, "title" text NOT NULL, "brief" text, "content" text NOT NULL, "meta" jsonb, CONSTRAINT "PK_5673d4aa27bd95298796b8abec7" PRIMARY KEY ("id")); COMMENT ON COLUMN "article_content"."author" IS 'Author details'; COMMENT ON COLUMN "article_content"."meta" IS 'SEO metadata, canonical URL, images, structured data, etc.'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_article_content_slug_lang" ON "article_content"  ("slug", "language") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_article_content_unique_per_lang" ON "article_content"  ("article_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "article_content" IS 'Language-specific content for articles (title, slug, brief, content, meta)'`,
		);
		await queryRunner.query(
			`CREATE TABLE "carrier" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "name" character varying NOT NULL, "website" character varying, "phone" character varying, "email" character varying, "notes" text, CONSTRAINT "PK_f615ebd1906f0270d41b3a5a8b0" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_carrier_name" ON "carrier"  ("name") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "carrier" IS 'Stores shipping carriers'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."operational_record_operational_record_type_enum" AS ENUM('client', 'vendor', 'order')`,
		);
		await queryRunner.query(
			`CREATE TABLE "operational_record" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "cash_flow_id" uuid NOT NULL, "operational_record_type" "public"."operational_record_operational_record_type_enum" NOT NULL, "entity_id" uuid NOT NULL, "notes" text, CONSTRAINT "PK_5455e9f4362fb1f5c3385a42a19" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_operational_record_entity_id" ON "operational_record"  ("entity_id", "operational_record_type") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_operational_record_cash_flow_id" ON "operational_record"  ("cash_flow_id", "operational_record_type") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "operational_record" IS 'Store operational records linked with cash flow operations.'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."cash_flow_direction_enum" AS ENUM('in', 'out')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."cash_flow_category_type_enum" AS ENUM('revenue', 'expense', 'correction')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."cash_flow_category_enum" AS ENUM('sale', 'vendor', 'insurance', 'taxes', 'refund')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."cash_flow_method_enum" AS ENUM('credit_card', 'debit_card', 'paypal', 'cash', 'bank_transfer', 'check', 'crypto', 'gift_card')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."cash_flow_status_enum" AS ENUM('pending', 'authorized', 'completed', 'failed', 'canceled', 'expired', 'requires_action')`,
		);
		await queryRunner.query(`CREATE TABLE "cash_flow" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "direction" "public"."cash_flow_direction_enum" NOT NULL DEFAULT 'in', "category_type" "public"."cash_flow_category_type_enum" NOT NULL DEFAULT 'revenue', "category" "public"."cash_flow_category_enum" NOT NULL DEFAULT 'sale', "method" "public"."cash_flow_method_enum" NOT NULL DEFAULT 'cash', "status" "public"."cash_flow_status_enum" NOT NULL DEFAULT 'pending', "amount" integer NOT NULL, "vat_rate" numeric(5,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "external_reference" character varying, "parent_id" uuid, "notes" text, CONSTRAINT "CHK_83b1bdb1c4cba011ebdd13239d" CHECK ((amount > 0)), CONSTRAINT "CHK_11adeb007366477372a65a2555" CHECK (
  (
    -- Direction + amount consistency for originals
    (parent_id IS NULL AND 
      ((category_type = 'revenue' AND direction = 'in') OR
       (category_type = 'expense' AND direction = 'out')))
  )
  OR 
  (
    -- Refunds / corrections
    (parent_id IS NOT NULL AND category_type = 'correction')
  )
), CONSTRAINT "PK_e28117f3ef2dc17143db0cb7ce1" PRIMARY KEY ("id")); COMMENT ON COLUMN "cash_flow"."amount" IS 'Amount intended to be charged; Note: Divide by 10000 for actual value. e.g. 806452 = 80.6452'; COMMENT ON COLUMN "cash_flow"."exchange_rate" IS 'Exchange rate to invoice base currency (default 1 = default currency)'; COMMENT ON COLUMN "cash_flow"."parent_id" IS 'Parent payment ID (e.g.: for refunds)'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_cash_flow_external_reference" ON "cash_flow"  ("external_reference") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cash_flow_parent_id" ON "cash_flow"  ("parent_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cash_flow_status_created_at" ON "cash_flow"  ("status", "created_at") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cash_flow_method_status" ON "cash_flow"  ("method", "status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cash_flow_category_created_at" ON "cash_flow"  ("category", "created_at") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cash_flow_created_at" ON "cash_flow"  ("created_at") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "cash_flow" IS 'Tracks cash flows.'`,
		);
		await queryRunner.query(
			`CREATE TABLE "brand_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "brand_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "description" text, "meta" jsonb, CONSTRAINT "PK_8e9d5488729b396e59d9144ea27" PRIMARY KEY ("id")); COMMENT ON COLUMN "brand_content"."meta" IS 'SEO metadata, canonical URL, images, structured data, etc.'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_brand_content_unique_per_lang" ON "brand_content"  ("brand_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "brand_content" IS 'Language-specific content for brands (descriptions, meta)'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."category_status_enum" AS ENUM('active', 'pending', 'inactive')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."category_type_enum" AS ENUM('product', 'article')`,
		);
		await queryRunner.query(
			`CREATE TABLE "category" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "status" "public"."category_status_enum" NOT NULL DEFAULT 'pending', "type" "public"."category_type_enum" NOT NULL DEFAULT 'product', "sort_order" integer NOT NULL DEFAULT '0', "details" jsonb, "parent_id" uuid, CONSTRAINT "PK_9c4e4a89e3674fc9f382d733f03" PRIMARY KEY ("id")); COMMENT ON COLUMN "category"."type" IS 'Specifies the entity type this category belongs to'; COMMENT ON COLUMN "category"."sort_order" IS 'Sort order among siblings'; COMMENT ON COLUMN "category"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_category_parent_id" ON "category"  ("parent_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_category_type" ON "category"  ("type", "status") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "category" IS 'Hierarchical product categories'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."category_content_type_enum" AS ENUM('product', 'article')`,
		);
		await queryRunner.query(
			`CREATE TABLE "category_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "category_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "type" "public"."category_content_type_enum" NOT NULL, "label" character varying NOT NULL, "slug" character varying NOT NULL, "description" text, "meta" jsonb, "details" jsonb, CONSTRAINT "PK_266faccfe1a64cd9a8e5479deed" PRIMARY KEY ("id")); COMMENT ON COLUMN "category_content"."type" IS 'The type is duplicated here from category to be used as unique index'; COMMENT ON COLUMN "category_content"."meta" IS 'SEO metadata, canonical URL, images, structured data, etc.'; COMMENT ON COLUMN "category_content"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_category_content_slug_language" ON "category_content"  ("type", "slug", "language") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_category_content_category_id_language" ON "category_content"  ("category_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "category_content" IS 'Language-specific category content (slug, description, metadata)'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."client_address_type_enum" AS ENUM('billing', 'delivery')`,
		);
		await queryRunner.query(
			`CREATE TABLE "client_address" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "client_id" uuid NOT NULL, "address_id" uuid NOT NULL, "type" "public"."client_address_type_enum" NOT NULL, "details" text, "notes" text, CONSTRAINT "PK_fea7ca529948e3e15c4f91b37fc" PRIMARY KEY ("id")); COMMENT ON COLUMN "client_address"."details" IS 'Flat, floor or apartment number within the address'; COMMENT ON COLUMN "client_address"."notes" IS 'Instructions about reaching the address'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_address_address_id" ON "client_address"  ("address_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_address_client_id" ON "client_address"  ("client_id", "type") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "client_address" IS 'Billing and delivery addresses held by a client'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."client_client_type_enum" AS ENUM('person', 'company')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."client_status_enum" AS ENUM('active', 'inactive', 'pending')`,
		);
		await queryRunner.query(
			`CREATE TABLE "client" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "client_type" "public"."client_client_type_enum" NOT NULL, "status" "public"."client_status_enum" NOT NULL DEFAULT 'pending', "company_name" character varying, "company_cui" character varying, "company_reg_com" character varying, "person_name" character varying, "person_identification_number" character varying, "iban" character varying, "bank_name" character varying, "contact_name" character varying, "contact_email" character varying, "contact_phone" character varying, "user_id" uuid, "notes" text, CONSTRAINT "PK_96da49381769303a6515a8785c7" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_user_id" ON "client"  ("user_id") WHERE user_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_cnp_unique" ON "client"  ("person_identification_number") WHERE person_identification_number IS NOT NULL AND client_type = 'person' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_reg_com_unique" ON "client"  ("company_reg_com") WHERE company_reg_com IS NOT NULL AND client_type = 'company' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_cui_unique" ON "client"  ("company_cui") WHERE company_cui IS NOT NULL AND client_type = 'company' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_company_name_unique" ON "client"  ("company_name") WHERE company_name IS NOT NULL AND client_type = 'company' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "client" IS 'Stores client information for persons OR companies'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."brand_status_enum" AS ENUM('active', 'inactive')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."brand_brand_type_enum" AS ENUM('product')`,
		);
		await queryRunner.query(
			`CREATE TABLE "brand" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "name" character varying NOT NULL, "slug" character varying NOT NULL, "status" "public"."brand_status_enum" NOT NULL DEFAULT 'active', "brand_type" "public"."brand_brand_type_enum" NOT NULL DEFAULT 'product', "sort_order" integer NOT NULL DEFAULT '0', "details" jsonb, CONSTRAINT "PK_a5d20765ddd942eb5de4eee2d7f" PRIMARY KEY ("id")); COMMENT ON COLUMN "brand"."brand_type" IS 'Specifies the entity type this brand belongs to'; COMMENT ON COLUMN "brand"."sort_order" IS 'Order/position of the brand in a listing'; COMMENT ON COLUMN "brand"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_brand_slug" ON "brand"  ("slug", "brand_type") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."complaint_entity_type_enum" AS ENUM('article', 'comment')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."complaint_reason_enum" AS ENUM('spam', 'offensive', 'harassment', 'hate_speech', 'misinformation', 'ai_slop', 'copyright')`,
		);
		await queryRunner.query(
			`CREATE TABLE "complaint" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "entity_type" "public"."complaint_entity_type_enum" NOT NULL, "entity_id" uuid NOT NULL, "user_id" uuid NOT NULL, "reason" "public"."complaint_reason_enum" NOT NULL, "description" text, "is_resolved" boolean NOT NULL DEFAULT false, "resolved_at" TIMESTAMP, "resolved_by" uuid, CONSTRAINT "CHK_complaint_resolved" CHECK (is_resolved = (resolved_at IS NOT NULL)), CONSTRAINT "PK_a9c8dbc2ab4988edcc2ff0a7337" PRIMARY KEY ("id")); COMMENT ON COLUMN "complaint"."resolved_by" IS 'Moderator user ID'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_complaint_user_id" ON "complaint"  ("user_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_complaint_open" ON "complaint"  ("created_at") WHERE is_resolved = false AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_complaint_user" ON "complaint"  ("entity_type", "entity_id", "user_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."exchange_rate_source_enum" AS ENUM('manual', 'import')`,
		);
		await queryRunner.query(`CREATE TABLE "exchange_rate" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "currency" character(3) NOT NULL, "base_currency" character(3) NOT NULL, "rate" numeric(14,8) NOT NULL, "rate_date" date NOT NULL, "source" "public"."exchange_rate_source_enum" NOT NULL DEFAULT 'manual', "provider" character varying(50), "notes" text, CONSTRAINT "CHK_fbdbbbb0fe8982eecf6944a710" CHECK (
	(source = 'import' AND provider IS NOT NULL)
	OR
	(source = 'manual' AND provider IS NULL)
), CONSTRAINT "CHK_e5971c61645c49d894b8910a3b" CHECK ((currency <> base_currency)), CONSTRAINT "CHK_f0363b25f1334572e0f12456e3" CHECK ((rate > 0)), CONSTRAINT "PK_5c5d27d2b900ef6cdeef0398472" PRIMARY KEY ("id")); COMMENT ON COLUMN "exchange_rate"."currency" IS 'ISO 4217 code being priced; the rate is for one unit of it'; COMMENT ON COLUMN "exchange_rate"."base_currency" IS 'ISO 4217 code the rate is expressed in; the deployment''s own'; COMMENT ON COLUMN "exchange_rate"."rate" IS 'Units of \`base_currency\` per one unit of \`currency\`'; COMMENT ON COLUMN "exchange_rate"."rate_date" IS 'Day the rate applies to'; COMMENT ON COLUMN "exchange_rate"."provider" IS 'Name of the feed the rate was imported from; NULL when manual'`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_exchange_rate_unique" ON "exchange_rate"  ("currency", "base_currency", "rate_date") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "exchange_rate" IS 'Published exchange rates per currency and day'`,
		);
		await queryRunner.query(
			`CREATE TABLE "image_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "image_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "title" text, "description" text, CONSTRAINT "PK_7f5b75103fb93c4bc1c1fd46496" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_image_content_unique_per_lang" ON "image_content"  ("image_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "image_content" IS 'Language-specific content for images'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."discount_scope_enum" AS ENUM('client', 'order', 'product', 'variant', 'category', 'brand', 'shipping')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."discount_reason_enum" AS ENUM('flash_sale', 'first_time_customer', 'loyalty_discount', 'birthday_discount', 'referral_discount', 'vip_discount', 'special_discount')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."discount_type_enum" AS ENUM('percent', 'amount')`,
		);
		await queryRunner.query(
			`CREATE TABLE "discount" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "label" character varying NOT NULL, "scope" "public"."discount_scope_enum" NOT NULL, "reason" "public"."discount_reason_enum" NOT NULL, "reference" character varying, "type" "public"."discount_type_enum" NOT NULL, "conditions" jsonb, "value" numeric(12,2) NOT NULL, "start_at" TIMESTAMP, "end_at" TIMESTAMP, "notes" text, CONSTRAINT "PK_d05d8712e429673e459e7f1cddb" PRIMARY KEY ("id")); COMMENT ON COLUMN "discount"."label" IS 'Discount name'; COMMENT ON COLUMN "discount"."reference" IS 'Coupon code, referral code, etc'; COMMENT ON COLUMN "discount"."conditions" IS 'Conditions the discount is subject to; all must be met for it to apply'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_discount_scope" ON "discount"  ("scope") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_discount_reason" ON "discount"  ("reason") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_discount_reference" ON "discount"  ("reference") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_discount_active" ON "discount"  ("start_at", "end_at", "scope") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "discount" IS 'Stores discount definitions. Note: Discount applied only for prices without VAT before exchange rate conversion'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."document_series_document_type_enum" AS ENUM('invoice', 'order', 'grn', 'subscription', 'order_return')`,
		);
		await queryRunner.query(
			`CREATE TABLE "document_series" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "document_type" "public"."document_series_document_type_enum" NOT NULL, "code" character varying(10) NOT NULL, "start_number" integer NOT NULL DEFAULT '1', "next_number" integer NOT NULL DEFAULT '1', "notes" text, CONSTRAINT "CHK_6e54f807fe46f0a46ca80ad5b2" CHECK (("start_number" > 0 AND "next_number" > 0)), CONSTRAINT "PK_187a27e33f96d78f669301cf572" PRIMARY KEY ("id")); COMMENT ON COLUMN "document_series"."code" IS 'Series prefix, e.g. INV'; COMMENT ON COLUMN "document_series"."start_number" IS 'First number of the series'; COMMENT ON COLUMN "document_series"."next_number" IS 'Number handed out by the next allocation'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_document_series_key" ON "document_series"  ("document_type") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "document_series" IS 'Document numbering series and their counters'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_status_enum" AS ENUM('pending', 'confirmed', 'completed', 'canceled')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_payment_method_enum" AS ENUM('cash_on_delivery', 'card', 'bank_transfer')`,
		);
		await queryRunner.query(
			`CREATE TABLE "order" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "client_id" uuid NOT NULL, "ref_code" character varying(10) NOT NULL, "ref_number" integer NOT NULL, "status" "public"."order_status_enum" NOT NULL DEFAULT 'pending', "payment_method" "public"."order_payment_method_enum", "billing_address" jsonb, "notes" text, "discount" jsonb, CONSTRAINT "PK_1031171c13130102495201e3e20" PRIMARY KEY ("id")); COMMENT ON COLUMN "order"."ref_code" IS 'Series code allocated from document_series, e.g. ORD'; COMMENT ON COLUMN "order"."ref_number" IS 'Sequential number within the series'; COMMENT ON COLUMN "order"."billing_address" IS 'Billing address snapshot, editable while the order is unbilled'; COMMENT ON COLUMN "order"."discount" IS 'Order-wide manual discount snapshot'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_client_id" ON "order"  ("client_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_status" ON "order"  ("status") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_ref" ON "order"  ("ref_code", "ref_number") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order" IS 'Stores order information'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_status_enum" AS ENUM('draft', 'issued', 'canceled')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_payment_status_enum" AS ENUM('unpaid', 'partial', 'paid')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_scope_enum" AS ENUM('order', 'shipping', 'subscription', 'custom')`,
		);
		await queryRunner.query(
			`CREATE TABLE "invoice" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "client_id" uuid NOT NULL, "ref_code" character varying(10), "ref_number" integer, "status" "public"."invoice_status_enum" NOT NULL DEFAULT 'draft', "payment_status" "public"."invoice_payment_status_enum" NOT NULL DEFAULT 'unpaid', "scope" "public"."invoice_scope_enum" NOT NULL DEFAULT 'order', "is_reversal" boolean NOT NULL DEFAULT false, "parent_invoice_id" uuid, "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "total_net" numeric(12,2) NOT NULL DEFAULT '0', "total_discount_reduction" numeric(12,2) NOT NULL DEFAULT '0', "total_vat" numeric(12,2) NOT NULL DEFAULT '0', "total_gross" numeric(12,2) NOT NULL DEFAULT '0', "issued_at" TIMESTAMP, "due_at" TIMESTAMP, "overdue_at" TIMESTAMP, "paid_at" TIMESTAMP, "billing_details" jsonb, "seller_details" jsonb, "details" jsonb, "notes" text, CONSTRAINT "CHK_469aaf113e976160b819d6f1cf" CHECK ((total_gross >= 0)), CONSTRAINT "CHK_8b3583bd91b9defc2d39f6ed06" CHECK ((total_vat >= 0)), CONSTRAINT "CHK_efa2715c0cc1157c392f107646" CHECK ((total_discount_reduction >= 0)), CONSTRAINT "CHK_f294116b12beccc45f7a41c1ee" CHECK ((total_net >= 0)), CONSTRAINT "CHK_484126b8280d68d154eafbc18b" CHECK ((is_reversal = (parent_invoice_id IS NOT NULL))), CONSTRAINT "PK_15d25c200d9bcd8a33f698daf18" PRIMARY KEY ("id")); COMMENT ON COLUMN "invoice"."ref_code" IS 'Series code allocated from document_series, e.g. INV'; COMMENT ON COLUMN "invoice"."ref_number" IS 'Sequential invoice number within the series'; COMMENT ON COLUMN "invoice"."currency" IS 'Currency the document is issued in'; COMMENT ON COLUMN "invoice"."exchange_rate" IS 'Exchange rate to the deployment base currency (default 1 = same currency)'; COMMENT ON COLUMN "invoice"."total_net" IS 'Sum of the line nets, after discount, excluding VAT'; COMMENT ON COLUMN "invoice"."total_discount_reduction" IS 'Money off across all lines, excluding VAT'; COMMENT ON COLUMN "invoice"."total_gross" IS 'What the buyer owes: total_net + total_vat'; COMMENT ON COLUMN "invoice"."billing_details" IS 'Snapshot of billing info at the moment of issuing the invoice'; COMMENT ON COLUMN "invoice"."seller_details" IS 'Snapshot of the issuer at the moment of issuing the invoice'; COMMENT ON COLUMN "invoice"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_status" ON "invoice"  ("status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_payment_status" ON "invoice"  ("payment_status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_scope" ON "invoice"  ("scope") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_parent_invoice_id" ON "invoice"  ("parent_invoice_id") WHERE parent_invoice_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_overdue_at" ON "invoice"  ("overdue_at") WHERE overdue_at IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_due_sweep" ON "invoice"  ("due_at") WHERE deleted_at IS NULL AND overdue_at IS NULL AND due_at IS NOT NULL AND status = 'issued'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_ref" ON "invoice"  ("ref_code", "ref_number") WHERE deleted_at IS NULL AND ref_number IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_client_settlement" ON "invoice"  ("client_id", "status", "payment_status") WHERE is_reversal = false`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice" IS 'Stores invoices'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."grn_status_enum" AS ENUM('draft', 'confirmed', 'canceled')`,
		);
		await queryRunner.query(
			`CREATE TABLE "grn" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "ref_code" character varying(10) NOT NULL, "ref_number" integer NOT NULL, "supplier_document_number" character varying, "status" "public"."grn_status_enum" NOT NULL DEFAULT 'draft', "received_at" TIMESTAMP NOT NULL, "confirmed_at" TIMESTAMP, "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "notes" text, "warehouse_id" uuid NOT NULL, "vendor_id" uuid NOT NULL, CONSTRAINT "PK_c8f750cac4dfd1fc623593ab3eb" PRIMARY KEY ("id")); COMMENT ON COLUMN "grn"."ref_code" IS 'Series code allocated from document_series, e.g. NIR'; COMMENT ON COLUMN "grn"."ref_number" IS 'Sequential number within the series'; COMMENT ON COLUMN "grn"."supplier_document_number" IS 'The supplier''s own delivery note or invoice number'; COMMENT ON COLUMN "grn"."received_at" IS 'When the goods physically arrived; drives FIFO order'; COMMENT ON COLUMN "grn"."confirmed_at" IS 'When the stock actually moved'; COMMENT ON COLUMN "grn"."currency" IS 'Currency the supplier invoiced in'; COMMENT ON COLUMN "grn"."exchange_rate" IS 'Rate to the base currency (1 = same currency)'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_grn_supplier_document_number" ON "grn"  ("supplier_document_number") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_grn_warehouse_id" ON "grn"  ("warehouse_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_grn_vendor_id" ON "grn"  ("vendor_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_grn_warehouse_status_received_at" ON "grn"  ("warehouse_id", "status", "received_at") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_grn_ref" ON "grn"  ("ref_code", "ref_number") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "grn" IS 'Goods received notes; the only way stock enters a warehouse, and the source of every FIFO lot'`,
		);
		await queryRunner.query(
			`CREATE TYPE "system"."mail_queue_status_enum" AS ENUM('pending', 'sent', 'error')`,
		);
		await queryRunner.query(
			`CREATE TABLE "system"."mail_queue" ("id" uuid NOT NULL DEFAULT uuidv7(), "template_id" uuid, "language" character varying(3) NOT NULL, "content" jsonb NOT NULL, "to" jsonb NOT NULL, "from" jsonb, "status" "system"."mail_queue_status_enum" NOT NULL DEFAULT 'pending', "error" text, "sent_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), CONSTRAINT "PK_fc59283e1a31da3ce216089305b" PRIMARY KEY ("id")); COMMENT ON COLUMN "system"."mail_queue"."content" IS 'Email content: subject, text, html, vars, layout'; COMMENT ON COLUMN "system"."mail_queue"."to" IS 'To: name & address'; COMMENT ON COLUMN "system"."mail_queue"."from" IS 'From: name & address'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_mail_queue_template_id" ON "system"."mail_queue"  ("template_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_mail_queue_status" ON "system"."mail_queue"  ("status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_mail_queue_sent_at" ON "system"."mail_queue"  ("sent_at") `,
		);
		await queryRunner.query(
			`CREATE TYPE "logs"."log_data_category_enum" AS ENUM('system', 'history', 'cron')`,
		);
		await queryRunner.query(
			`CREATE TYPE "logs"."log_data_level_enum" AS ENUM('trace', 'debug', 'info', 'warn', 'error', 'fatal')`,
		);
		await queryRunner.query(
			`CREATE TABLE "logs"."log_data" ("id" uuid NOT NULL DEFAULT uuidv7(), "pid" character(36) NOT NULL, "request_id" character varying, "category" "logs"."log_data_category_enum" NOT NULL, "level" "logs"."log_data_level_enum" NOT NULL, "message" text NOT NULL, "context" text, "debug_stack" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ee6ddd7720fe93171a6b62e4be6" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_data_pid" ON "logs"."log_data"  ("pid") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_data_request_id" ON "logs"."log_data"  ("request_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_data" ON "logs"."log_data"  ("level", "category", "created_at") `,
		);
		await queryRunner.query(
			`CREATE TYPE "system"."template_type_enum" AS ENUM('page', 'email')`,
		);
		await queryRunner.query(
			`CREATE TABLE "system"."template" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "label" character varying NOT NULL, "language" character varying(3) NOT NULL, "type" "system"."template_type_enum" NOT NULL DEFAULT 'page', "content" jsonb NOT NULL, CONSTRAINT "PK_fbae2ac36bd9b5e1e793b957b7f" PRIMARY KEY ("id")); COMMENT ON COLUMN "system"."template"."content" IS 'Template data'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_label_language_type" ON "system"."template"  ("label", "language", "type") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."template" IS 'Stores email & page templates'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."image_section_enum" AS ENUM('product', 'product_variant', 'category', 'brand', 'article')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."image_image_type_enum" AS ENUM('logo', 'gallery')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."image_storage_enum" AS ENUM('local', 's3')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."image_status_enum" AS ENUM('active', 'inactive')`,
		);
		await queryRunner.query(
			`CREATE TABLE "image" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "section" "public"."image_section_enum" NOT NULL, "entity_id" uuid NOT NULL, "image_type" "public"."image_image_type_enum" NOT NULL, "storage" "public"."image_storage_enum" NOT NULL DEFAULT 'local', "path" text NOT NULL, "properties" jsonb, "status" "public"."image_status_enum" NOT NULL DEFAULT 'active', "sort_order" integer NOT NULL DEFAULT '0', "details" jsonb, CONSTRAINT "PK_d6db1ab4ee9ad9dbe86c64e4cc3" PRIMARY KEY ("id")); COMMENT ON COLUMN "image"."section" IS 'The section this image belongs to'; COMMENT ON COLUMN "image"."entity_id" IS 'ID of the entity this image is linked to'; COMMENT ON COLUMN "image"."image_type" IS 'The type of the image'; COMMENT ON COLUMN "image"."storage" IS 'The storage destination of the image'; COMMENT ON COLUMN "image"."properties" IS 'Properties of the file'; COMMENT ON COLUMN "image"."sort_order" IS 'Order/position of the image within the entity type'; COMMENT ON COLUMN "image"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_image_storage" ON "image"  ("storage") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_image_type_id" ON "image"  ("entity_id", "section", "image_type") `,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_return_status_enum" AS ENUM('requested', 'approved', 'rejected', 'received', 'closed', 'canceled')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."order_return_reason_enum" AS ENUM('damaged', 'defective', 'wrong_item', 'not_as_described', 'no_longer_needed', 'other')`,
		);
		await queryRunner.query(
			`CREATE TABLE "order_return" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "ref_code" character varying(10) NOT NULL, "ref_number" integer NOT NULL, "status" "public"."order_return_status_enum" NOT NULL DEFAULT 'requested', "reason" "public"."order_return_reason_enum" NOT NULL, "customer_notes" text, "response" text, "decided_at" TIMESTAMP, "received_at" TIMESTAMP, "closed_at" TIMESTAMP, "reversal_invoice_ids" uuid array NOT NULL DEFAULT '{}', "refund_shipping" boolean NOT NULL DEFAULT false, "notes" text, "order_id" uuid NOT NULL, "shipping_id" uuid, "user_id" uuid, CONSTRAINT "PK_36413fb3df0d9d66ae67cbdcb9a" PRIMARY KEY ("id")); COMMENT ON COLUMN "order_return"."ref_code" IS 'Series code allocated from document_series, e.g. RMA'; COMMENT ON COLUMN "order_return"."ref_number" IS 'Sequential number within the series'; COMMENT ON COLUMN "order_return"."customer_notes" IS 'What the buyer wrote with the request'; COMMENT ON COLUMN "order_return"."response" IS 'What the buyer is told about the decision'; COMMENT ON COLUMN "order_return"."decided_at" IS 'When it was approved or rejected'; COMMENT ON COLUMN "order_return"."received_at" IS 'When the return movement reached its warehouse'; COMMENT ON COLUMN "order_return"."reversal_invoice_ids" IS 'Draft reversals raised for the returned goods; no FK, an array cannot carry one'; COMMENT ON COLUMN "order_return"."refund_shipping" IS 'Refund the outbound delivery fee with the goods; read when the refund is drafted'; COMMENT ON COLUMN "order_return"."notes" IS 'Internal, never shown to the buyer'; COMMENT ON COLUMN "order_return"."shipping_id" IS 'The return movement, once approved'; COMMENT ON COLUMN "order_return"."user_id" IS 'The account that asked; null when raised in the back office'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_user_id" ON "order_return"  ("user_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_return_shipping_id" ON "order_return"  ("shipping_id") WHERE shipping_id IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_status" ON "order_return"  ("status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_order_status" ON "order_return"  ("order_id", "status") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_return_ref" ON "order_return"  ("ref_code", "ref_number") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_return" IS 'Return authorizations: a request to send goods back, and the decision on it'`,
		);
		await queryRunner.query(
			`CREATE TABLE "system"."permission" ("id" uuid NOT NULL DEFAULT uuidv7(), "entity" character varying NOT NULL, "operation" character varying NOT NULL, "deleted_at" TIMESTAMP, CONSTRAINT "PK_3b8b97af9d9d8807e41e6f48362" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_permission" ON "system"."permission"  ("entity", "operation") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."permission" IS 'Stores permissions'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_scope_enum" AS ENUM('delivery', 'relocation', 'return')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_status_enum" AS ENUM('pending', 'preparing', 'shipped', 'delivered', 'failed', 'returned', 'canceled')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_method_enum" AS ENUM('self_pickup', 'courier')`,
		);
		await queryRunner.query(`CREATE TABLE "shipping" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "scope" "public"."shipping_scope_enum" NOT NULL, "order_id" uuid, "document_ref" uuid, "status" "public"."shipping_status_enum" NOT NULL DEFAULT 'pending', "method" "public"."shipping_method_enum" NOT NULL, "carrier_id" uuid, "pickup_warehouse_id" uuid, "pickup_client_address_id" uuid, "destination_warehouse_id" uuid, "destination_client_address_id" uuid, "pickup_data" jsonb, "destination_data" jsonb, "tracking_number" character varying, "tracking_url" character varying, "vat_rate" numeric(5,2) NOT NULL, "price" numeric(12,2) NOT NULL, "operational_cost" numeric(12,2), "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "discount" jsonb, "discount_reduction" numeric(12,2) NOT NULL DEFAULT '0', "contact_name" character varying, "contact_phone" character varying, "contact_email" character varying, "shipped_at" TIMESTAMP, "delivered_at" TIMESTAMP, "estimated_delivery_at" TIMESTAMP, "notes" text, CONSTRAINT "CHK_03ba9c2f16356c8226759d98b3" CHECK (
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
), CONSTRAINT "PK_0dc6ac92ee9cbc2c1611d77804c" PRIMARY KEY ("id")); COMMENT ON COLUMN "shipping"."document_ref" IS 'Id of the relocation document; no table for it yet, so no key'; COMMENT ON COLUMN "shipping"."pickup_data" IS 'Origin address frozen when the movement was marked shipped'; COMMENT ON COLUMN "shipping"."destination_data" IS 'Destination address frozen when the movement was marked shipped'; COMMENT ON COLUMN "shipping"."operational_cost" IS 'Internal cost of the movement, in base currency'; COMMENT ON COLUMN "shipping"."currency" IS 'Currency is specific to client'; COMMENT ON COLUMN "shipping"."exchange_rate" IS 'Exchange rate to invoice base currency (default 1 = same currency)'; COMMENT ON COLUMN "shipping"."discount" IS 'Array of discount snapshots applied'; COMMENT ON COLUMN "shipping"."discount_reduction" IS 'Money off the price, excluding VAT, in the shipment currency'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_scope" ON "shipping"  ("scope") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_order_id" ON "shipping"  ("order_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_document_ref" ON "shipping"  ("document_ref") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_status" ON "shipping"  ("status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_method" ON "shipping"  ("method") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_carrier_id" ON "shipping"  ("carrier_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_pickup_warehouse_id" ON "shipping"  ("pickup_warehouse_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_pickup_client_address_id" ON "shipping"  ("pickup_client_address_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_destination_warehouse_id" ON "shipping"  ("destination_warehouse_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_destination_client_address_id" ON "shipping"  ("destination_client_address_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_shipping_tracking_number" ON "shipping"  ("tracking_number") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "shipping" IS 'Physical movements of goods: deliveries to a client, relocations between warehouses, and returns'`,
		);
		await queryRunner.query(
			`CREATE TABLE "vat_rate" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "country_code" character(2) NOT NULL, "category" character varying(32) NOT NULL, "rate" numeric(5,2) NOT NULL, "valid_from" date NOT NULL, "notes" text, CONSTRAINT "CHK_697cd476439589d54e51808d35" CHECK ((category IN ('standard', 'reduced', 'second_reduced'))), CONSTRAINT "CHK_e7debdbe1dc0d0dac35b3ed28f" CHECK ((rate >= 0 AND rate < 100)), CONSTRAINT "PK_e7a4f4bdee032b0c3e3f6450510" PRIMARY KEY ("id")); COMMENT ON COLUMN "vat_rate"."country_code" IS 'ISO 3166-1 alpha-2 of the jurisdiction'; COMMENT ON COLUMN "vat_rate"."category" IS 'VAT class key; see RatedVatCategoryEnum'; COMMENT ON COLUMN "vat_rate"."rate" IS 'Percentage, e.g. 21.00'; COMMENT ON COLUMN "vat_rate"."valid_from" IS 'First day the rate applies'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_vat_rate_unique" ON "vat_rate"  ("country_code", "category", "valid_from") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "vat_rate" IS 'VAT percentage per country and VAT class, from the day it applies'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_workflow_enum" AS ENUM('draft', 'pending_review', 'revision_required', 'ready')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_sale_status_enum" AS ENUM('available', 'coming_soon', 'unavailable', 'discontinued')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_type_enum" AS ENUM('physical', 'digital', 'service')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_composition_enum" AS ENUM('simple', 'bundle')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_unit_enum" AS ENUM('piece', 'kg', 'litre', 'metre', 'hour')`,
		);
		await queryRunner.query(
			`CREATE TABLE "product" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "workflow" "public"."product_workflow_enum" NOT NULL DEFAULT 'draft', "sale_status" "public"."product_sale_status_enum" NOT NULL DEFAULT 'available', "type" "public"."product_type_enum" NOT NULL DEFAULT 'physical', "composition" "public"."product_composition_enum" NOT NULL DEFAULT 'simple', "unit" "public"."product_unit_enum" NOT NULL DEFAULT 'piece', "vat_category" character varying(32) NOT NULL DEFAULT 'standard', "available_from" TIMESTAMP, "available_until" TIMESTAMP, "discontinued_at" TIMESTAMP, "details" jsonb, "brand_id" uuid, CONSTRAINT "PK_bebc9158e480b949565b4dc7a82" PRIMARY KEY ("id")); COMMENT ON COLUMN "product"."vat_category" IS 'VAT class key; see ProductVatCategoryEnum'; COMMENT ON COLUMN "product"."available_from" IS 'Controls when the product becomes sellable'; COMMENT ON COLUMN "product"."available_until" IS 'Controls when the product stops being sellable'; COMMENT ON COLUMN "product"."discontinued_at" IS 'Set once the product is permanently withdrawn from the catalog'; COMMENT ON COLUMN "product"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_workflow" ON "product"  ("workflow") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_brand_id" ON "product"  ("brand_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_discontinued_at" ON "product"  ("discontinued_at") WHERE discontinued_at IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_available_until" ON "product"  ("available_until") WHERE available_until IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_available_from" ON "product"  ("available_from") WHERE available_from IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product" IS 'Stores core product information; textual content is saved in a product-content.entity, prices in a product-price.entity'`,
		);
		await queryRunner.query(
			`CREATE TABLE "place_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "place_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "name" character varying NOT NULL, "type_label" character varying NOT NULL, "details" jsonb, CONSTRAINT "PK_5af1716076889988270c39bd6ff" PRIMARY KEY ("id")); COMMENT ON COLUMN "place_content"."type_label" IS 'ex: Country, Region, City, Oras, Judet'; COMMENT ON COLUMN "place_content"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_place_content_unique_per_lang" ON "place_content"  ("place_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "place_content" IS 'Language-specific content for places'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."place_place_type_enum" AS ENUM('country', 'region', 'city')`,
		);
		await queryRunner.query(
			`CREATE TABLE "place" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "place_type" "public"."place_place_type_enum" NOT NULL DEFAULT 'country', "parent_id" uuid, "code" character varying(3), "alpha2_code" character varying(2), CONSTRAINT "PK_96ab91d43aa89c5de1b59ee7cca" PRIMARY KEY ("id")); COMMENT ON COLUMN "place"."code" IS 'Abbreviation'; COMMENT ON COLUMN "place"."alpha2_code" IS 'ISO 3166-1 alpha-2, countries only; the vocabulary country rules are matched against'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_place_parent_id" ON "place"  ("parent_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_place_code" ON "place"  ("code") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "place" IS 'Places (countries, regions, cities)'`,
		);
		await queryRunner.query(
			`CREATE TABLE "term_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "term_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "value" character varying(255) NOT NULL, CONSTRAINT "PK_174ae6c46610cd4e8b290b41542" PRIMARY KEY ("id")); COMMENT ON COLUMN "term_content"."value" IS 'Localized term value'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_term_content_unique_per_lang" ON "term_content"  ("term_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "term_content" IS 'Language-specific wording for terms'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."user_status_enum" AS ENUM('active', 'inactive', 'pending')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."user_role_enum" AS ENUM('admin', 'member', 'operator')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."user_operator_type_enum" AS ENUM('seller', 'product_manager', 'content_editor')`,
		);
		await queryRunner.query(
			`CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "name" character varying NOT NULL, "email" character varying NOT NULL, "email_verified_at" TIMESTAMP, "password" character varying, "password_updated_at" TIMESTAMP NOT NULL, "language" character varying(3) NOT NULL, "status" "public"."user_status_enum" NOT NULL DEFAULT 'pending', "role" "public"."user_role_enum" NOT NULL DEFAULT 'member', "operator_type" "public"."user_operator_type_enum", CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id")); COMMENT ON COLUMN "user"."operator_type" IS 'Operator type; only relevant when role is OPERATOR'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_user_email" ON "user"  ("email") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."term_type_enum" AS ENUM('tag', 'attribute_label', 'attribute_value', 'text', 'bundle_choice')`,
		);
		await queryRunner.query(
			`CREATE TABLE "term" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "type" "public"."term_type_enum" NOT NULL, CONSTRAINT "PK_55b0479f0743f2e5d5ec414821e" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_term_type" ON "term"  ("type") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "term" IS 'Multilingual taxonomy terms: categories, tags, attribute labels/values'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."vendor_type_enum" AS ENUM('supplier', 'provider')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."vendor_status_enum" AS ENUM('active', 'inactive', 'pending')`,
		);
		await queryRunner.query(
			`CREATE TABLE "vendor" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "name" character varying NOT NULL, "type" "public"."vendor_type_enum" NOT NULL DEFAULT 'supplier', "status" "public"."vendor_status_enum" NOT NULL DEFAULT 'pending', CONSTRAINT "PK_931a23f6231a57604f5a0e32780" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_vendor_name" ON "vendor"  ("name") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_vendor_type" ON "vendor"  ("type") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_vendor_status" ON "vendor"  ("status") `,
		);
		await queryRunner.query(`COMMENT ON TABLE "vendor" IS 'Store vendors'`);
		await queryRunner.query(
			`CREATE TYPE "public"."warehouse_status_enum" AS ENUM('active', 'inactive')`,
		);
		await queryRunner.query(
			`CREATE TABLE "warehouse" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "address_id" uuid NOT NULL, "code" character varying(16) NOT NULL, "name" character varying NOT NULL, "status" "public"."warehouse_status_enum" NOT NULL DEFAULT 'active', "is_default" boolean NOT NULL DEFAULT false, "notes" text, CONSTRAINT "PK_965abf9f99ae8c5983ae74ebde8" PRIMARY KEY ("id")); COMMENT ON COLUMN "warehouse"."code" IS 'Short internal identifier, e.g. BUC-01'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_address_id" ON "warehouse"  ("address_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_warehouse_code" ON "warehouse"  ("code") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_name" ON "warehouse"  ("name") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_status" ON "warehouse"  ("status") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_warehouse_default" ON "warehouse"  ("is_default") WHERE is_default = true AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "warehouse" IS 'Locations stock is held in, and the origin goods are shipped from - including for products that are not stock-tracked'`,
		);
		await queryRunner.query(
			`CREATE TABLE "user_permission" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "permission_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_a7326749e773c740a7104634a77" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_user_permission_permission_id" ON "user_permission"  ("permission_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_user_permission_permission" ON "user_permission"  ("user_id", "permission_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "user_permission" IS 'Stores user permissions'`,
		);
		await queryRunner.query(
			`CREATE TABLE "article_category" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "article_id" uuid NOT NULL, "category_id" uuid NOT NULL, "details" jsonb, CONSTRAINT "PK_cdd234ef147c8552a8abd42bd29" PRIMARY KEY ("id")); COMMENT ON COLUMN "article_category"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_category_category_id" ON "article_category"  ("category_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_article_category_unique" ON "article_category"  ("article_id", "category_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "article_category" IS 'Link articles to categories'`,
		);
		await queryRunner.query(
			`CREATE TABLE "article_tag" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "article_id" uuid NOT NULL, "tag_id" uuid NOT NULL, "details" jsonb, CONSTRAINT "PK_43dc2fa69a4739ce178e021d649" PRIMARY KEY ("id")); COMMENT ON COLUMN "article_tag"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_tag_tag_id" ON "article_tag"  ("tag_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_article_tag_unique" ON "article_tag"  ("article_id", "tag_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "article_tag" IS 'Links articles to tag terms'`,
		);
		await queryRunner.query(
			`CREATE TABLE "article_visibility_rule" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "article_id" uuid NOT NULL, "requires_auth" boolean NOT NULL DEFAULT false, "requires_subscription" boolean NOT NULL DEFAULT false, "allowed_countries" character varying(2) array, "password" character varying, "is_listed" boolean NOT NULL DEFAULT true, CONSTRAINT "REL_4a239efc040ebec82f2736f490" UNIQUE ("article_id"), CONSTRAINT "PK_f14deeb133759688c6364b51a08" PRIMARY KEY ("id")); COMMENT ON COLUMN "article_visibility_rule"."requires_auth" IS 'Only logged-in users can view the article'; COMMENT ON COLUMN "article_visibility_rule"."requires_subscription" IS 'An active subscription is required to view the article'; COMMENT ON COLUMN "article_visibility_rule"."allowed_countries" IS 'ISO 3166-1 alpha-2 codes allowed to view; null means no country restriction'; COMMENT ON COLUMN "article_visibility_rule"."password" IS 'Hashed password required to view the article'; COMMENT ON COLUMN "article_visibility_rule"."is_listed" IS 'Whether the article is listed in indexes, feeds and search'`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "article_visibility_rule" IS 'Visibility rules for articles with restricted visibility'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."discount_target_target_type_enum" AS ENUM('client', 'variant', 'product', 'category', 'brand')`,
		);
		await queryRunner.query(
			`CREATE TABLE "discount_target" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "discount_id" uuid NOT NULL, "target_type" "public"."discount_target_target_type_enum" NOT NULL, "entity_id" uuid NOT NULL, CONSTRAINT "PK_1ffa9d4344c912c20248193ce74" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_discount_target_entity" ON "discount_target"  ("target_type", "entity_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_discount_target_unique" ON "discount_target"  ("discount_id", "target_type", "entity_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "discount_target" IS 'What a discount applies to; polymorphic by target_type, the window and conditions stay on the discount'`,
		);
		await queryRunner.query(
			`CREATE TABLE "grn_item" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "grn_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "qty" numeric(12,2) NOT NULL, "qty_remaining" numeric(12,2) NOT NULL DEFAULT '0', "unit_cost" numeric(12,2) NOT NULL, "unit_cost_base" numeric(12,4) NOT NULL, "vat_rate" numeric(5,2) NOT NULL DEFAULT '0', "lot_code" character varying, "expires_at" date, "notes" text, CONSTRAINT "CHK_aa436f46cf91e3341bcf3029a4" CHECK ((unit_cost_base >= 0)), CONSTRAINT "CHK_2a6f7dd1ff8c2e4591b7c8779f" CHECK ((unit_cost >= 0)), CONSTRAINT "CHK_f5878ab091acacbd4ed45f07fb" CHECK ((qty_remaining >= 0 AND qty_remaining <= qty)), CONSTRAINT "CHK_0acd56d60a2530cfdd485dcebf" CHECK ((qty > 0)), CONSTRAINT "PK_59d7f54b35043e6a4e4dfa48998" PRIMARY KEY ("id")); COMMENT ON COLUMN "grn_item"."qty" IS 'Quantity received; never changes once confirmed'; COMMENT ON COLUMN "grn_item"."qty_remaining" IS 'Quantity still in this lot; 0 means the lot is closed'; COMMENT ON COLUMN "grn_item"."unit_cost" IS 'Unit cost as invoiced, in the receipt currency'; COMMENT ON COLUMN "grn_item"."unit_cost_base" IS 'Unit cost in base currency, frozen at the receipt exchange rate'; COMMENT ON COLUMN "grn_item"."vat_rate" IS 'VAT rate on the purchase, for the payable'; COMMENT ON COLUMN "grn_item"."lot_code" IS 'The supplier''s batch identifier, when they give one'; COMMENT ON COLUMN "grn_item"."expires_at" IS 'Expiry date of this lot, when the goods carry one'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_grn_item_variant_id" ON "grn_item"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_grn_item_variant_open" ON "grn_item"  ("variant_id") WHERE qty_remaining > 0 AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_grn_item_unique" ON "grn_item"  ("grn_id", "variant_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "grn_item" IS 'Received lines; each is a FIFO lot, and qty_remaining is the authoritative on-hand figure'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_line_kind_enum" AS ENUM('product', 'shipping', 'adjustment')`,
		);
		await queryRunner.query(`CREATE TABLE "invoice_line" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" uuid NOT NULL, "kind" "public"."invoice_line_kind_enum" NOT NULL DEFAULT 'product', "order_line_id" uuid, "shipping_id" uuid, "parent_line_id" uuid, "is_value_reversal" boolean NOT NULL DEFAULT false, "product_id" uuid, "variant_id" uuid, "label" character varying NOT NULL, "quantity" numeric(12,2) NOT NULL, "unit_price" numeric(12,2) NOT NULL, "vat_rate" numeric(5,2) NOT NULL, "discount" jsonb, "discount_reduction" numeric(12,2) NOT NULL DEFAULT '0', "line_net" numeric(12,2) NOT NULL, "line_vat" numeric(12,2) NOT NULL, "line_total" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "CHK_e696f079a6042f4824d804eea5" CHECK (
	(
		is_value_reversal = false
		OR (parent_line_id IS NOT NULL AND order_line_id IS NULL AND shipping_id IS NULL)
	)
), CONSTRAINT "CHK_204882c6d0a420f02a01079154" CHECK (
	(
		(kind = 'product' AND shipping_id IS NULL)
		OR (kind = 'shipping' AND order_line_id IS NULL)
		OR (kind = 'adjustment' AND order_line_id IS NULL AND shipping_id IS NULL)
	)
), CONSTRAINT "CHK_10e4fed44164dae88fd91875e2" CHECK ((discount_reduction >= 0)), CONSTRAINT "CHK_88af87ae3aa1e7a09facbccb62" CHECK ((vat_rate >= 0)), CONSTRAINT "CHK_3d24410142c56bc2333efca868" CHECK ((unit_price >= 0)), CONSTRAINT "CHK_2c9101507b300b8787e6a8351c" CHECK ((quantity > 0)), CONSTRAINT "PK_112d67e85951a56ee5123e9c803" PRIMARY KEY ("id")); COMMENT ON COLUMN "invoice_line"."label" IS 'What is billed, as it read on the day - name plus any options'; COMMENT ON COLUMN "invoice_line"."unit_price" IS 'Unit price excluding VAT, in the invoice currency'; COMMENT ON COLUMN "invoice_line"."discount" IS 'Array of discount snapshots applied'; COMMENT ON COLUMN "invoice_line"."discount_reduction" IS 'Money off the whole line, excluding VAT'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_invoice_id" ON "invoice_line"  ("invoice_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_order_line_id" ON "invoice_line"  ("order_line_id") WHERE order_line_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_shipping_id" ON "invoice_line"  ("shipping_id") WHERE shipping_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_parent_line_id" ON "invoice_line"  ("parent_line_id") WHERE parent_line_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_line_product_id" ON "invoice_line"  ("product_id") WHERE product_id IS NOT NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice_line" IS 'Stores invoice line items'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."invoice_source_source_type_enum" AS ENUM('order', 'shipping', 'subscription')`,
		);
		await queryRunner.query(
			`CREATE TABLE "invoice_source" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" uuid NOT NULL, "source_type" "public"."invoice_source_source_type_enum" NOT NULL, "source_id" uuid NOT NULL, CONSTRAINT "PK_26060ccbd4e27f5862d5bd34819" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_source_target" ON "invoice_source"  ("source_type", "source_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_source_invoice" ON "invoice_source"  ("invoice_id", "source_type") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice_source" IS 'What each invoice was raised from - order, shipping, subscription'`,
		);
		await queryRunner.query(
			`CREATE TABLE "order_line" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "order_id" uuid NOT NULL, "parent_id" uuid, "bundle_item_id" uuid, "variant_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "vat_rate" numeric(5,2) NOT NULL, "price" numeric(12,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "discount" jsonb, "discount_reduction" numeric(12,2) NOT NULL DEFAULT '0', "options" jsonb, "notes" text, CONSTRAINT "CHK_63448672b165cfbda408b500bd" CHECK ((discount_reduction >= 0)), CONSTRAINT "CHK_3166f9d6b8cd45aaa56376fc5b" CHECK ((vat_rate >= 0)), CONSTRAINT "CHK_6525a883b48cf5636f57201377" CHECK ((price >= 0)), CONSTRAINT "CHK_b4c4e3bfaf46f359f9e28b8a66" CHECK ((quantity > 0)), CONSTRAINT "PK_01a7c973d9f30479647e44f9892" PRIMARY KEY ("id")); COMMENT ON COLUMN "order_line"."currency" IS 'Currency is specific to client'; COMMENT ON COLUMN "order_line"."exchange_rate" IS 'Exchange rate to invoice base currency (default 1 = same currency)'; COMMENT ON COLUMN "order_line"."discount" IS 'Array of discount snapshots applied'; COMMENT ON COLUMN "order_line"."discount_reduction" IS 'Money off the whole line, in the line currency'; COMMENT ON COLUMN "order_line"."options" IS 'Array of option snapshots chosen, each carrying its price delta'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_line_order_id" ON "order_line"  ("order_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_line_parent_id" ON "order_line"  ("parent_id") WHERE parent_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_line_variant_id" ON "order_line"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_line_product_id" ON "order_line"  ("product_id") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_line" IS 'Stores order line items'`,
		);
		await queryRunner.query(
			`CREATE TABLE "order_return_line" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "order_return_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, CONSTRAINT "CHK_391c0a525b5a6375d86ca36ed8" CHECK ((quantity > 0)), CONSTRAINT "PK_49402b020a9dc896bfb025a1257" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_order_return_line_variant_id" ON "order_return_line"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_order_return_line_unique" ON "order_return_line"  ("order_return_id", "variant_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "order_return_line" IS 'What a return asks to send back, by variant and quantity'`,
		);
		await queryRunner.query(`CREATE TABLE "product_attribute" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "attribute_label_id" uuid NOT NULL, "value_term_id" uuid, "value_numeric" numeric(14,4), "value_base" numeric(20,6), "value_text" character varying(255), "value_boolean" boolean, CONSTRAINT "CHK_aa707808285fe47e69e3c8edbc" CHECK (
	(
		(value_term_id IS NOT NULL)::int
		+ (value_numeric IS NOT NULL)::int
		+ (value_text IS NOT NULL)::int
		+ (value_boolean IS NOT NULL)::int
	) = 1
	AND (value_numeric IS NULL) = (value_base IS NULL)
), CONSTRAINT "PK_f9b91f38df3dbbe481d9e056e5e" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_attribute"."value_numeric" IS 'Bare measurement as entered; the unit comes from the definition'; COMMENT ON COLUMN "product_attribute"."value_base" IS 'Normalized measurement; what range filters compare'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_attribute_product_id" ON "product_attribute"  ("product_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_attribute_attribute_label_id" ON "product_attribute"  ("attribute_label_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_attribute_attribute_value_id" ON "product_attribute"  ("value_term_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_attribute_term_facet" ON "product_attribute"  ("attribute_label_id", "value_term_id", "product_id") WHERE value_term_id IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_attribute_numeric_facet" ON "product_attribute"  ("attribute_label_id", "value_base", "product_id") WHERE value_base IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_attribute_unique_scalar" ON "product_attribute"  ("product_id", "attribute_label_id") WHERE value_term_id IS NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_attribute_unique" ON "product_attribute"  ("product_id", "attribute_label_id", "value_term_id") WHERE value_term_id IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_attribute" IS 'Key/value attributes for products, using multilingual terms'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_availability" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "day_of_week" smallint, "starts_at" TIME, "ends_at" TIME, CONSTRAINT "CHK_product_availability_hours_order" CHECK (("starts_at" IS NULL OR "ends_at" > "starts_at")), CONSTRAINT "CHK_product_availability_hours_paired" CHECK ((("starts_at" IS NULL) = ("ends_at" IS NULL))), CONSTRAINT "CHK_product_availability_day_of_week" CHECK ((day_of_week IS NULL OR (day_of_week >= 1 AND day_of_week <= 7))), CONSTRAINT "PK_2953b5489dac4bd2235d96c2230" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_availability"."day_of_week" IS 'Day this window applies to, ISO 8601 weekday, 1 = Monday; NULL means every day'; COMMENT ON COLUMN "product_availability"."starts_at" IS 'Window opens, venue local time; NULL together with ends_at means all day'; COMMENT ON COLUMN "product_availability"."ends_at" IS 'Window closes, venue local time; NULL together with starts_at means all day'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_availability_product_id" ON "product_availability"  ("product_id", "day_of_week") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_availability" IS 'Recurring ordering windows for a product; no row at all means unrestricted'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_bundle_group" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "label_id" uuid NOT NULL, "position" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_08f1302234d4b46d3560277d829" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_bundle_group"."product_id" IS 'The bundle this choice belongs to'; COMMENT ON COLUMN "product_bundle_group"."label_id" IS 'Term holding the multilingual prompt, e.g. "Choose your fries"'; COMMENT ON COLUMN "product_bundle_group"."position" IS 'Display order within the bundle'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_bundle_group_label_id" ON "product_bundle_group"  ("label_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_bundle_group_product_id" ON "product_bundle_group"  ("product_id", "position") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_bundle_group" IS 'A choice offered inside a bundle; exactly one of its product-bundle-item candidates is taken'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_bundle_item_price" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "item_id" uuid NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "price_delta" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_7a3e4166f3ca6678a53698aa79e" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_bundle_item_price"."price_delta" IS 'Added to the component price when it is taken; negative subtracts'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_bundle_item_price_item_id" ON "product_bundle_item_price"  ("item_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_bundle_item_price_unique" ON "product_bundle_item_price"  ("item_id", "currency") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_bundle_item_price" IS 'Per-currency price delta for an optional bundle component; excludes VAT, like product-price.entity'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_bundle_item" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL DEFAULT '1', "group_id" uuid, "position" integer NOT NULL DEFAULT '0', "is_optional" boolean NOT NULL DEFAULT false, "is_default" boolean NOT NULL DEFAULT false, CONSTRAINT "CHK_53dcf10353fd7e1a68acc04402" CHECK ((quantity > 0)), CONSTRAINT "PK_8122cf28ef84ed7579411282f52" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_bundle_item"."product_id" IS 'The bundle this component belongs to'; COMMENT ON COLUMN "product_bundle_item"."variant_id" IS 'The variant consumed when this component is part of the order'; COMMENT ON COLUMN "product_bundle_item"."quantity" IS 'How many of the variant this component contributes, or the most the customer may take when is_optional'; COMMENT ON COLUMN "product_bundle_item"."group_id" IS 'The choice this component is a candidate for; NULL means it is not part of one'; COMMENT ON COLUMN "product_bundle_item"."position" IS 'Display order within the group, or within the bundle'; COMMENT ON COLUMN "product_bundle_item"."is_optional" IS 'The customer chooses whether to take this component on its own terms; refused inside a group, where the group decides'; COMMENT ON COLUMN "product_bundle_item"."is_default" IS 'Preselected; meaningless on a component that is neither optional nor in a group'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_bundle_item_default" ON "product_bundle_item"  ("group_id") WHERE is_default = true AND group_id IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_bundle_item_group_id" ON "product_bundle_item"  ("group_id", "position") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_bundle_item_variant_id" ON "product_bundle_item"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_bundle_item_product_id" ON "product_bundle_item"  ("product_id", "position") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_bundle_item" IS 'A component of a bundle: always included, an optional tick box, or a candidate within a group'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_category_attribute_option" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "attribute_id" uuid NOT NULL, "term_id" uuid NOT NULL, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_369f7ce719988e26ac668b6c3f7" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_category_attribute_option"."sort_order" IS 'Order the option is offered in'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_category_attribute_option_term_id" ON "product_category_attribute_option"  ("term_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_category_attribute_option_unique" ON "product_category_attribute_option"  ("attribute_id", "term_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_category_attribute_option_attribute_id" ON "product_category_attribute_option"  ("attribute_id", "sort_order") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_category_attribute_option" IS 'One admissible value for a list-backed product category attribute'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_category_attribute_scope_enum" AS ENUM('product', 'variant')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_category_attribute_value_type_enum" AS ENUM('term', 'number', 'string', 'boolean')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."product_category_attribute_type_enum" AS ENUM('input', 'select', 'radio', 'checkbox')`,
		);
		await queryRunner.query(`CREATE TABLE "product_category_attribute" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "category_id" uuid NOT NULL, "attribute_label_id" uuid NOT NULL, "scope" "public"."product_category_attribute_scope_enum" NOT NULL DEFAULT 'product', "value_type" "public"."product_category_attribute_value_type_enum" NOT NULL DEFAULT 'term', "type" "public"."product_category_attribute_type_enum" NOT NULL DEFAULT 'select', "unit" character varying(16), "prefix" character varying(16), "suffix" character varying(16), "min_value" numeric(14,4), "max_value" numeric(14,4), "is_required" boolean NOT NULL DEFAULT false, "is_filterable" boolean NOT NULL DEFAULT false, "inherit" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_0d6db621eeec5734c6c409e708" CHECK (
	((min_value IS NULL AND max_value IS NULL) OR value_type = 'number')
	AND (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
), CONSTRAINT "CHK_3f7bd35546f4ec0bc6062c587c" CHECK (
	(unit IS NULL OR value_type = 'number')
	AND NOT (unit IS NOT NULL AND suffix IS NOT NULL)
), CONSTRAINT "CHK_3313378a263ecec379a0177c6f" CHECK (
	(type = 'input' AND value_type IN ('number', 'string', 'boolean'))
	OR (type IN ('select', 'radio') AND value_type = 'term')
	OR (type = 'checkbox' AND value_type IN ('term', 'boolean'))
), CONSTRAINT "PK_4b82fb3ff49209b417aaa3ff23c" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_category_attribute"."value_type" IS 'Decides which value column the attribute row occupies'; COMMENT ON COLUMN "product_category_attribute"."type" IS 'How the value is captured'; COMMENT ON COLUMN "product_category_attribute"."unit" IS 'MeasureUnitEnum key; numeric attributes only'; COMMENT ON COLUMN "product_category_attribute"."prefix" IS 'Rendered before the value (e.g. \`class\`)'; COMMENT ON COLUMN "product_category_attribute"."suffix" IS 'Rendered after the value when no \`unit\` applies'; COMMENT ON COLUMN "product_category_attribute"."min_value" IS 'Lowest accepted value; numeric attributes only'; COMMENT ON COLUMN "product_category_attribute"."max_value" IS 'Highest accepted value; numeric attributes only'; COMMENT ON COLUMN "product_category_attribute"."is_required" IS 'Whether a product in this category must supply the attribute'; COMMENT ON COLUMN "product_category_attribute"."sort_order" IS 'Display order within the category'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_category_attribute_label_id" ON "product_category_attribute"  ("attribute_label_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_category_attribute_category_id" ON "product_category_attribute"  ("category_id", "sort_order") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_category_attribute_unique" ON "product_category_attribute"  ("category_id", "attribute_label_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_category_attribute" IS 'Per-category definition of the attributes a product is expected to carry'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_category" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "category_id" uuid NOT NULL, "details" jsonb, CONSTRAINT "PK_0dce9bc93c2d2c399982d04bef1" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_category"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_category_category_id" ON "product_category"  ("category_id", "product_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_category_product_id" ON "product_category"  ("product_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_category_unique" ON "product_category"  ("product_id", "category_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_category" IS 'Links products to categories (multilingual via term)'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_content" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "product_id" uuid NOT NULL, "language" character varying(3) NOT NULL DEFAULT 'en', "label" character varying NOT NULL, "slug" character varying NOT NULL, "description" text, "meta" jsonb, CONSTRAINT "PK_2bf2e348130d697f3ee3aa4e94e" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_content"."meta" IS 'SEO metadata, canonical URL, images, structured data, etc.'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_content_slug_lang" ON "product_content"  ("slug", "language") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_content_unique_per_lang" ON "product_content"  ("product_id", "language") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_content" IS 'Language-specific content for products (name, slug, descriptions, meta)'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_option_group" ("id" uuid NOT NULL DEFAULT uuidv7(), "product_id" uuid NOT NULL, "label_id" uuid NOT NULL, "min_select" integer NOT NULL DEFAULT '0', "max_select" integer, "position" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), CONSTRAINT "CHK_7e6651f28c44c3e4bc9e11dcbc" CHECK ((max_select IS NULL OR max_select >= min_select)), CONSTRAINT "CHK_1913c423e1e541d0532d2ecf8e" CHECK ((min_select >= 0)), CONSTRAINT "PK_d76e92fdbbb5a2e6752ffd4a2c1" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_option_group"."label_id" IS 'Term holding the multilingual prompt, e.g. "Choose a side"'; COMMENT ON COLUMN "product_option_group"."min_select" IS 'Answers that must be chosen; 0 makes the group optional'; COMMENT ON COLUMN "product_option_group"."max_select" IS 'Answers that may be chosen; NULL means no upper bound'; COMMENT ON COLUMN "product_option_group"."position" IS 'Display order within the product'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_option_group_label_id" ON "product_option_group"  ("label_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_option_group_product_id" ON "product_option_group"  ("product_id", "position") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_option_group" IS 'A choice offered on a product at order time; the answers live in product-option.entity'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_option_price" ("id" uuid NOT NULL DEFAULT uuidv7(), "option_id" uuid NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "price_delta" numeric(12,2) NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), CONSTRAINT "PK_6b5e6386450dfecb1edda899d8f" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_option_price"."price_delta" IS 'Added to the variant price; negative subtracts'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_option_price_option_id" ON "product_option_price"  ("option_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_option_price_unique" ON "product_option_price"  ("option_id", "currency") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_option_price" IS 'Per-currency price delta for a product option; excludes VAT, like product-price.entity'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_option" ("id" uuid NOT NULL DEFAULT uuidv7(), "option_group_id" uuid NOT NULL, "label_id" uuid NOT NULL, "position" integer NOT NULL DEFAULT '0', "is_default" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), CONSTRAINT "PK_4cf3c467e9bc764bdd32c4cd938" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_option"."label_id" IS 'Term holding the multilingual answer, e.g. "Extra bacon"'; COMMENT ON COLUMN "product_option"."position" IS 'Display order within the group'; COMMENT ON COLUMN "product_option"."is_default" IS 'Preselected when the customer has not chosen'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_option_default" ON "product_option"  ("option_group_id") WHERE is_default = true`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_option_label_id" ON "product_option"  ("label_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_option_group_id" ON "product_option"  ("option_group_id", "position") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_option" IS 'An answer within a product option group; priced as a delta'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_price" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "variant_id" uuid NOT NULL, "currency" character(3) NOT NULL DEFAULT 'RON', "sale_price" numeric(12,2) NOT NULL, "reference_price" numeric(12,2), "min_price" numeric(12,2), CONSTRAINT "CHK_fdb767537306f80593e4e9cbe4" CHECK ((min_price IS NULL OR min_price <= sale_price)), CONSTRAINT "CHK_106bdefdc8d75378ca855d0911" CHECK ((reference_price IS NULL OR reference_price > 0)), CONSTRAINT "CHK_586ebf7f8d2a8512644b30951e" CHECK ((sale_price > 0)), CONSTRAINT "PK_039c4320ccd5ede07440f499268" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_price"."sale_price" IS 'What the customer is charged, per \`product.unit\`'; COMMENT ON COLUMN "product_price"."reference_price" IS 'The usual price this sale is measured against (a manufacturer''s RRP, a list price); display only, never charged'; COMMENT ON COLUMN "product_price"."min_price" IS 'Lowest price a discount may resolve to'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_price_variant_id" ON "product_price"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_price_unique" ON "product_price"  ("variant_id", "currency") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_price" IS 'Per-currency price set for a product variant; every value excludes VAT, matching the contract discounts are applied under'`,
		);
		await queryRunner.query(`CREATE TABLE "product_variant_attribute" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "variant_id" uuid NOT NULL, "attribute_label_id" uuid NOT NULL, "value_term_id" uuid, "value_numeric" numeric(14,4), "value_base" numeric(20,6), "value_text" character varying(255), "value_boolean" boolean, CONSTRAINT "CHK_9e4e03d1a5048face1dd805f66" CHECK (
	(
		(value_term_id IS NOT NULL)::int
		+ (value_numeric IS NOT NULL)::int
		+ (value_text IS NOT NULL)::int
		+ (value_boolean IS NOT NULL)::int
	) = 1
	AND (value_numeric IS NULL) = (value_base IS NULL)
), CONSTRAINT "PK_90417758096050aa5d9d6e30c0a" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_variant_attribute"."value_numeric" IS 'Bare measurement as entered; the unit comes from the definition'; COMMENT ON COLUMN "product_variant_attribute"."value_base" IS 'Normalized measurement; what range filters compare'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_attribute_variant_id" ON "product_variant_attribute"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_attribute_label_id" ON "product_variant_attribute"  ("attribute_label_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_attribute_value_id" ON "product_variant_attribute"  ("value_term_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_attribute_term_facet" ON "product_variant_attribute"  ("attribute_label_id", "value_term_id", "variant_id") WHERE value_term_id IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_attribute_numeric_facet" ON "product_variant_attribute"  ("attribute_label_id", "value_base", "variant_id") WHERE value_base IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_variant_attribute_unique" ON "product_variant_attribute"  ("variant_id", "attribute_label_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_variant_attribute" IS 'The axis values that define a variant, using multilingual terms'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_variant" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "sku" character varying NOT NULL, "barcode" character varying, "position" integer NOT NULL DEFAULT '0', "is_default" boolean NOT NULL DEFAULT false, "track_stock" boolean NOT NULL DEFAULT false, "low_stock_threshold" integer, "allow_backorder" boolean NOT NULL DEFAULT false, "cost_price" numeric(12,2), CONSTRAINT "CHK_1018e4c3e7cd4b55322df57aee" CHECK ((cost_price IS NULL OR cost_price >= 0)), CONSTRAINT "PK_1ab69c9935c61f7c70791ae0a9f" PRIMARY KEY ("id")); COMMENT ON COLUMN "product_variant"."sku" IS 'The code that is actually sold; \`product.sku\` is the style above it'; COMMENT ON COLUMN "product_variant"."barcode" IS 'External identifier (EAN / UPC / GTIN)'; COMMENT ON COLUMN "product_variant"."position" IS 'Display order within the product'; COMMENT ON COLUMN "product_variant"."is_default" IS 'The variant offered when the customer has not chosen one'; COMMENT ON COLUMN "product_variant"."track_stock" IS 'Whether goods receipts and stock movements apply to it'; COMMENT ON COLUMN "product_variant"."low_stock_threshold" IS 'Quantity at or below which the variant counts as low stock'; COMMENT ON COLUMN "product_variant"."allow_backorder" IS 'Whether it can still be ordered with nothing on hand'; COMMENT ON COLUMN "product_variant"."cost_price" IS 'Weighted average acquisition cost in the base currency; drives margin reporting'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_variant_sku" ON "product_variant"  ("sku") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_variant_barcode" ON "product_variant"  ("barcode") WHERE barcode IS NOT NULL AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_variant_default" ON "product_variant"  ("product_id") WHERE is_default = true AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_product_id" ON "product_variant"  ("product_id", "position") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_variant_id_product_id" ON "product_variant"  ("id", "product_id") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_variant" IS 'The purchasable unit of a product; prices and order lines reference this, not the product'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."shipping_line_condition_enum" AS ENUM('resellable', 'damaged')`,
		);
		await queryRunner.query(
			`CREATE TABLE "shipping_line" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "shipping_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "condition" "public"."shipping_line_condition_enum", "notes" text, CONSTRAINT "CHK_a13de553ea8db2addb25270831" CHECK ((quantity > 0)), CONSTRAINT "PK_890522bfc44a4b6eb7cb1e52609" PRIMARY KEY ("id")); COMMENT ON COLUMN "shipping_line"."condition" IS 'What a returned unit is fit for; return movements only'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_line_variant_id" ON "shipping_line"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_shipping_line_product_id" ON "shipping_line"  ("product_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_shipping_line_unique" ON "shipping_line"  ("shipping_id", "variant_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "shipping_line" IS 'What physically travels in one movement, by variant and quantity'`,
		);
		await queryRunner.query(
			`CREATE TABLE "product_tag" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "tag_id" uuid NOT NULL, CONSTRAINT "PK_1439455c6528caa94fcc8564fda" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_tag_tag_id" ON "product_tag"  ("tag_id", "product_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_tag_product_id" ON "product_tag"  ("product_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_tag_unique" ON "product_tag"  ("product_id", "tag_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_tag" IS 'Links products to tag terms'`,
		);
		await queryRunner.query(
			`CREATE TABLE "invoice_payment" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "invoice_id" uuid NOT NULL, "cash_flow_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "CHK_388f0505985acccaf83ae26f17" CHECK ((amount > 0)), CONSTRAINT "PK_b63cfba23ecc43531b5c571ffa3" PRIMARY KEY ("id")); COMMENT ON COLUMN "invoice_payment"."amount" IS 'Amount settled, in the invoice currency'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_payment_invoice_id" ON "invoice_payment"  ("invoice_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_invoice_payment_cash_flow_id" ON "invoice_payment"  ("cash_flow_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_invoice_payment_pair" ON "invoice_payment"  ("invoice_id", "cash_flow_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "invoice_payment" IS 'Settles a cash movement against an invoice, in part or in full'`,
		);
		await queryRunner.query(
			`CREATE TYPE "system"."account_identity_provider_enum" AS ENUM('google', 'facebook')`,
		);
		await queryRunner.query(
			`CREATE TABLE "system"."account_identity" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "provider" "system"."account_identity_provider_enum" NOT NULL, "provider_user_id" character varying(191) NOT NULL, "email" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "last_login_at" TIMESTAMP, CONSTRAINT "PK_ff3623f6775193bb2a7286c2e81" PRIMARY KEY ("id")); COMMENT ON COLUMN "system"."account_identity"."provider_user_id" IS 'Subject id as reported by the provider (\`sub\` / Graph \`id\`)'; COMMENT ON COLUMN "system"."account_identity"."email" IS 'Email reported by the provider at link time; kept for auditing only'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_account_identity_user_provider" ON "system"."account_identity"  ("user_id", "provider") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_account_identity_provider_subject" ON "system"."account_identity"  ("provider", "provider_user_id") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."account_identity" IS 'Links a user to an external identity provider (social sign-in)'`,
		);
		await queryRunner.query(
			`CREATE TABLE "system"."account_token" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "ident" character(36) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "metadata" json, "used_at" TIMESTAMP, "expire_at" TIMESTAMP NOT NULL, CONSTRAINT "PK_a55842d3341d42534e39f85e931" PRIMARY KEY ("id")); COMMENT ON COLUMN "system"."account_token"."metadata" IS 'Fingerprinting data'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_account_token_user_id" ON "system"."account_token"  ("user_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_account_token_ident" ON "system"."account_token"  ("ident") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."account_token" IS 'Stores \`ident\` for account tokens to manage token revocation'`,
		);
		await queryRunner.query(
			`CREATE TABLE "system"."account_recovery" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "ident" character(36) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "metadata" json, "used_at" TIMESTAMP, "expire_at" TIMESTAMP NOT NULL, CONSTRAINT "PK_d4901111d598239fd13e230f618" PRIMARY KEY ("id")); COMMENT ON COLUMN "system"."account_recovery"."metadata" IS 'Fingerprinting data'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_account_recovery_user_id" ON "system"."account_recovery"  ("user_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_account_recovery_ident" ON "system"."account_recovery"  ("ident") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."account_recovery" IS 'Stores \`ident\` for account password recovery requests'`,
		);
		await queryRunner.query(
			`CREATE TABLE "cart_item" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "cart_id" uuid NOT NULL, "parent_id" uuid, "bundle_item_id" uuid, "variant_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, "options" jsonb, "options_hash" character varying(64) NOT NULL DEFAULT '', "notes" text, CONSTRAINT "CHK_cart_item_quantity" CHECK ((quantity > 0)), CONSTRAINT "PK_bd94725aa84f8cf37632bcde997" PRIMARY KEY ("id")); COMMENT ON COLUMN "cart_item"."options" IS 'Chosen product_option ids, ascending'; COMMENT ON COLUMN "cart_item"."options_hash" IS 'Hash of the ascending option ids, empty when there are none'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_item_cart_id" ON "cart_item"  ("cart_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_item_variant_id" ON "cart_item"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_item_parent_id" ON "cart_item"  ("parent_id") WHERE parent_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_component" ON "cart_item"  ("parent_id", "bundle_item_id") WHERE parent_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_item_line" ON "cart_item"  ("cart_id", "variant_id", "options_hash") WHERE parent_id IS NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "cart_item" IS 'Stores cart lines; deliberately holds no prices'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."client_ledger_entry_type_enum" AS ENUM('payment', 'refund')`,
		);
		await queryRunner.query(
			`CREATE TABLE "client_ledger" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "client_id" uuid NOT NULL, "entry_type" "public"."client_ledger_entry_type_enum" NOT NULL, "cash_flow_id" uuid NOT NULL, "currency" character(3) NOT NULL, "amount" numeric(12,2) NOT NULL, "exchange_rate" numeric(10,6) NOT NULL DEFAULT '1', "amount_base" numeric(14,2) NOT NULL, "occurred_at" TIMESTAMP NOT NULL, CONSTRAINT "CHK_614d4d375c0768dca19906f16d" CHECK ((amount <> 0)), CONSTRAINT "PK_b2ac9f0b0e7ef2e7fb6da288e0b" PRIMARY KEY ("id")); COMMENT ON COLUMN "client_ledger"."currency" IS 'Currency of the movement'; COMMENT ON COLUMN "client_ledger"."amount" IS 'Positive: money received from the client; negative: money paid back'; COMMENT ON COLUMN "client_ledger"."exchange_rate" IS 'Rate to the deployment base currency, frozen from the movement'; COMMENT ON COLUMN "client_ledger"."amount_base" IS 'amount * exchange_rate, in the deployment base currency'; COMMENT ON COLUMN "client_ledger"."occurred_at" IS 'When the money moved'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_client_ledger_cash_flow" ON "client_ledger"  ("cash_flow_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_client_ledger_client_currency" ON "client_ledger"  ("client_id", "currency", "occurred_at") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "client_ledger" IS 'Append-only record of the money moved with each client, per currency'`,
		);
		await queryRunner.query(
			`CREATE TABLE "cart" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "token" uuid NOT NULL, "user_id" uuid, "currency" character(3) NOT NULL DEFAULT 'RON', "expires_at" TIMESTAMP NOT NULL, CONSTRAINT "PK_c524ec48751b9b5bcfbf6e59be7" PRIMARY KEY ("id")); COMMENT ON COLUMN "cart"."token" IS 'Opaque handle held by the client, guest identity'; COMMENT ON COLUMN "cart"."currency" IS 'Market the cart is priced in'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_token" ON "cart"  ("token") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cart_expires_at" ON "cart"  ("expires_at") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_cart_user" ON "cart"  ("user_id") WHERE user_id IS NOT NULL`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "cart" IS 'Stores shopping carts, for guests and members alike'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."comment_entity_type_enum" AS ENUM('article', 'review')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."comment_type_enum" AS ENUM('comment', 'question', 'tip')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."comment_status_enum" AS ENUM('pending', 'rejected', 'spam', 'approved', 'flagged')`,
		);
		await queryRunner.query(
			`CREATE TABLE "comment" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "entity_type" "public"."comment_entity_type_enum" NOT NULL, "entity_id" uuid NOT NULL, "type" "public"."comment_type_enum" NOT NULL DEFAULT 'comment', "content" text NOT NULL, "edited_at" TIMESTAMP, "status" "public"."comment_status_enum" NOT NULL DEFAULT 'pending', "parent_id" uuid, "user_id" uuid, "user_ip_hash" character varying NOT NULL, "guest_name" character varying, "guest_email" character varying, "guest_website" character varying, "reply_count" integer NOT NULL DEFAULT '0', "is_pinned" boolean NOT NULL DEFAULT false, "is_staff" boolean NOT NULL DEFAULT false, "moderated_at" TIMESTAMP, "moderated_by" uuid, "moderation_reason" character varying, "notified_at" TIMESTAMP, CONSTRAINT "CHK_comment_author" CHECK (user_id IS NOT NULL OR (guest_name IS NOT NULL AND guest_email IS NOT NULL)), CONSTRAINT "PK_0b0e4bbc8415ec426f87f3a88e2" PRIMARY KEY ("id")); COMMENT ON COLUMN "comment"."parent_id" IS 'Parent comment ID'; COMMENT ON COLUMN "comment"."user_ip_hash" IS 'Recorded IP address (hashed for privacy)'; COMMENT ON COLUMN "comment"."guest_name" IS 'Guest commenter name if not logged in'; COMMENT ON COLUMN "comment"."guest_email" IS 'Guest commenter email'; COMMENT ON COLUMN "comment"."guest_website" IS 'Guest commenter website'; COMMENT ON COLUMN "comment"."is_staff" IS 'Staff/administrator comment'; COMMENT ON COLUMN "comment"."moderated_by" IS 'Moderator user ID'; COMMENT ON COLUMN "comment"."moderation_reason" IS 'Reason for moderation action'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_comment_parent_id" ON "comment"  ("parent_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_comment_notify_pending" ON "comment"  ("notified_at") WHERE status = 'approved' AND notified_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_comment_user_ip_hash" ON "comment"  ("user_ip_hash", "created_at") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_comment_user_status" ON "comment"  ("user_id", "status", "created_at") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_comment_moderation" ON "comment"  ("created_at") WHERE status = 'pending'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_comment_entity" ON "comment"  ("entity_type", "entity_id", "status", "parent_id", "created_at") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "comment" IS 'Stores user comments on articles and replies to reviews'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."comment_subscription_entity_type_enum" AS ENUM('article', 'review')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."comment_subscription_notification_type_enum" AS ENUM('all', 'replies_to_me', 'unsubscribed')`,
		);
		await queryRunner.query(
			`CREATE TABLE "comment_subscription" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, "user_name" character varying NOT NULL, "user_email" character varying NOT NULL, "entity_type" "public"."comment_subscription_entity_type_enum" NOT NULL, "entity_id" uuid NOT NULL, "language" character varying(3) NOT NULL, "notification_type" "public"."comment_subscription_notification_type_enum" NOT NULL DEFAULT 'all', "unsubscribe_token" character varying(64) NOT NULL, CONSTRAINT "PK_9c8ae068d33a3853fc4b5e49a9f" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_comment_subscription_token" ON "comment_subscription"  ("unsubscribe_token") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_comment_subscription_user" ON "comment_subscription"  ("entity_type", "entity_id", "user_email") `,
		);
		await queryRunner.query(
			`CREATE TYPE "logs"."cron_history_status_enum" AS ENUM('error', 'ok', 'warning', 'running')`,
		);
		await queryRunner.query(
			`CREATE TABLE "logs"."cron_history" ("id" uuid NOT NULL DEFAULT uuidv7(), "label" character varying NOT NULL, "start_at" TIMESTAMP NOT NULL, "end_at" TIMESTAMP, "status" "logs"."cron_history_status_enum" NOT NULL, "run_time" smallint NOT NULL DEFAULT '0', "content" jsonb, CONSTRAINT "PK_459b846bf883b0de2833b411c19" PRIMARY KEY ("id")); COMMENT ON COLUMN "logs"."cron_history"."run_time" IS 'Run time in seconds'; COMMENT ON COLUMN "logs"."cron_history"."content" IS 'Cron data'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cron_history_start_at" ON "logs"."cron_history"  ("start_at") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_cron_history_status" ON "logs"."cron_history"  ("status") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "logs"."cron_history" IS 'Stores cron usage'`,
		);
		await queryRunner.query(
			`CREATE TABLE "logs"."log_history" ("id" uuid NOT NULL DEFAULT uuidv7(), "entity" character varying NOT NULL, "entity_id" uuid NOT NULL, "action" character varying NOT NULL, "auth_id" uuid, "performed_by" character varying NOT NULL, "request_id" character varying NOT NULL, "source" character varying NOT NULL, "recorded_at" TIMESTAMP NOT NULL, "details" jsonb, CONSTRAINT "PK_837ee3d001208e2b7400e7a0487" PRIMARY KEY ("id")); COMMENT ON COLUMN "logs"."log_history"."details" IS 'Log data'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_history_auth_id" ON "logs"."log_history"  ("auth_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_history_performed_by" ON "logs"."log_history"  ("performed_by") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_history_request_id" ON "logs"."log_history"  ("request_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_history_source" ON "logs"."log_history"  ("source") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_history_recorded_at" ON "logs"."log_history"  ("recorded_at") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_log_history_entity_id_action" ON "logs"."log_history"  ("entity", "entity_id", "action") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "logs"."log_history" IS 'Store entities history: created, updated, deleted, etc.'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."rating_entity_type_enum" AS ENUM('article', 'comment')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."rating_type_enum" AS ENUM('like', 'stars', 'emoji')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."rating_reaction_enum" AS ENUM('like', 'dislike', 'love', 'insightful', 'funny')`,
		);
		await queryRunner.query(
			`CREATE TABLE "rating" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "entity_type" "public"."rating_entity_type_enum" NOT NULL, "type" "public"."rating_type_enum" NOT NULL, "entity_id" uuid NOT NULL, "user_id" uuid, "user_ip_hash" character varying NOT NULL, "value" integer, "reaction" "public"."rating_reaction_enum", CONSTRAINT "CHK_rating_stars_range" CHECK (type <> 'stars' OR value BETWEEN 1 AND 5), CONSTRAINT "CHK_rating_like_range" CHECK (type <> 'like' OR value IN (-1, 1)), CONSTRAINT "CHK_rating_value" CHECK ((type = 'emoji') = (value IS NULL)), CONSTRAINT "CHK_rating_reaction" CHECK ((type = 'emoji') = (reaction IS NOT NULL)), CONSTRAINT "PK_ecda8ad32645327e4765b43649e" PRIMARY KEY ("id")); COMMENT ON COLUMN "rating"."user_ip_hash" IS 'Recorded IP address (hashed for privacy)'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_rating_entity" ON "rating"  ("entity_type", "entity_id", "type") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_rating_user" ON "rating"  ("entity_type", "entity_id", "type", "user_id") WHERE user_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_rating_ip" ON "rating"  ("entity_type", "entity_id", "type", "user_ip_hash") `,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."review_status_enum" AS ENUM('pending', 'rejected', 'spam', 'approved')`,
		);
		await queryRunner.query(`CREATE TABLE "review" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "product_id" uuid NOT NULL, "variant_id" uuid, "order_id" uuid, "rating" jsonb NOT NULL, "rating_avg" numeric(3,2) NOT NULL, "content" text NOT NULL, "status" "public"."review_status_enum" NOT NULL DEFAULT 'pending', "user_id" uuid NOT NULL, "is_pinned" boolean NOT NULL DEFAULT false, "is_verified" boolean NOT NULL DEFAULT false, "moderated_at" TIMESTAMP, "moderated_by" uuid, "moderation_reason" character varying, CONSTRAINT "CHK_review_rating" CHECK (jsonb_typeof(rating) = 'object'
	 AND rating - 'quality' - 'price' - 'service' - 'delivery' = '{}'::jsonb
	 AND rating ?| array['quality', 'price', 'service', 'delivery']
	 AND (NOT rating ? 'quality' OR (jsonb_typeof(rating->'quality') = 'number' AND rating->'quality' BETWEEN '1'::jsonb AND '5'::jsonb))
	 AND (NOT rating ? 'price' OR (jsonb_typeof(rating->'price') = 'number' AND rating->'price' BETWEEN '1'::jsonb AND '5'::jsonb))
	 AND (NOT rating ? 'service' OR (jsonb_typeof(rating->'service') = 'number' AND rating->'service' BETWEEN '1'::jsonb AND '5'::jsonb))
	 AND (NOT rating ? 'delivery' OR (jsonb_typeof(rating->'delivery') = 'number' AND rating->'delivery' BETWEEN '1'::jsonb AND '5'::jsonb))), CONSTRAINT "CHK_review_rating_avg_range" CHECK (rating_avg BETWEEN 1 AND 5), CONSTRAINT "PK_2e4299a343a81574217255c00ca" PRIMARY KEY ("id")); COMMENT ON COLUMN "review"."rating" IS 'Scores out of 5, keyed by dimension'; COMMENT ON COLUMN "review"."is_verified" IS 'Verified buyer'; COMMENT ON COLUMN "review"."moderated_by" IS 'Moderator user ID'; COMMENT ON COLUMN "review"."moderation_reason" IS 'Reason for moderation action'`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "UQ_review_user" ON "review"  ("product_id", "user_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_review_variant" ON "review"  ("variant_id", "created_at") WHERE variant_id IS NOT NULL AND status = 'approved' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_review_order" ON "review"  ("order_id") WHERE order_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_review_user_status" ON "review"  ("user_id", "status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_review_moderation" ON "review"  ("created_at") WHERE status = 'pending' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_review_product_rating" ON "review"  ("product_id", "rating_avg") WHERE status = 'approved' AND deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_review_product" ON "review"  ("product_id", "status", "created_at") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "review" IS 'Stores product reviews'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."subscription_evidence_status_enum" AS ENUM('success', 'failed')`,
		);
		await queryRunner.query(
			`CREATE TABLE "subscription_evidence" ("id" uuid NOT NULL DEFAULT uuidv7(), "subscription_id" uuid NOT NULL, "invoice_id" uuid NOT NULL, "status" "public"."subscription_evidence_status_enum" NOT NULL, "response_data" jsonb, "fail_reason" text, "recorded_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_751c8a105d4627fc564ab7e2fed" PRIMARY KEY ("id")); COMMENT ON COLUMN "subscription_evidence"."response_data" IS 'Response data from the payment gateway. For example: { "transaction_id": "1234567890" }'`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_subscription_evidence_subscription_id" ON "subscription_evidence"  ("subscription_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_subscription_evidence_invoice_id" ON "subscription_evidence"  ("invoice_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_subscription_evidence_status" ON "subscription_evidence"  ("status") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "subscription_evidence" IS 'Used to track renewal attempts for subscriptions.'`,
		);
		await queryRunner.query(
			`CREATE TABLE "stock_reservation" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "quantity" numeric(12,2) NOT NULL, CONSTRAINT "CHK_1b07e88213a2fde09e0cfa477a" CHECK ((quantity > 0)), CONSTRAINT "PK_a1f7c9841feb7e5744923efa2d2" PRIMARY KEY ("id"))`,
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
			`CREATE TYPE "public"."subscription_status_enum" AS ENUM('active', 'paused', 'canceled', 'expired')`,
		);
		await queryRunner.query(
			`CREATE TABLE "subscription" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "order_id" uuid NOT NULL, "user_id" uuid, "ref_code" character varying NOT NULL, "status" "public"."subscription_status_enum" NOT NULL DEFAULT 'active', "start_at" TIMESTAMP, "end_at" TIMESTAMP, "grace_period" smallint NOT NULL DEFAULT '0', "auto_renew" boolean NOT NULL DEFAULT true, "retry_count" smallint NOT NULL, "retry_interval" smallint NOT NULL, "next_billing_at" TIMESTAMP, "notes" text, "details" jsonb, CONSTRAINT "PK_8c3e00ebd02103caa1174cd5d9d" PRIMARY KEY ("id")); COMMENT ON COLUMN "subscription"."user_id" IS 'When subscription is assigned to a user (virtual services)'; COMMENT ON COLUMN "subscription"."ref_code" IS 'Subscription reference code (e.g., S12345)'; COMMENT ON COLUMN "subscription"."start_at" IS 'When the subscription started'; COMMENT ON COLUMN "subscription"."end_at" IS 'When the subscription ended (if canceled/expired)'; COMMENT ON COLUMN "subscription"."grace_period" IS 'Number of days offered past end at as a grace period to allow renewals'; COMMENT ON COLUMN "subscription"."auto_renew" IS 'Whether the subscription renews automatically'; COMMENT ON COLUMN "subscription"."retry_count" IS 'Max count of renewals attempts before the subscription is marked as expired'; COMMENT ON COLUMN "subscription"."retry_interval" IS 'Number of days between each renewal attempt'; COMMENT ON COLUMN "subscription"."next_billing_at" IS 'Next scheduled billing date'; COMMENT ON COLUMN "subscription"."details" IS 'Reserved column for future use'`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_subscription_order_id" ON "subscription"  ("order_id") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_subscription_user_id" ON "subscription"  ("user_id") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_subscription_ref_code" ON "subscription"  ("ref_code") WHERE deleted_at IS NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_subscription_status" ON "subscription"  ("status") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_subscription_end_at" ON "subscription"  ("end_at", "status") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "subscription" IS 'Recurring subscriptions created from orders'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."warehouse_movement_movement_type_enum" AS ENUM('receipt', 'sale', 'sale_return', 'supplier_return', 'adjustment', 'write_off', 'transfer_in', 'transfer_out')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."warehouse_movement_source_type_enum" AS ENUM('grn_item', 'shipping_line', 'adjustment')`,
		);
		await queryRunner.query(`CREATE TABLE "warehouse_movement" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "movement_type" "public"."warehouse_movement_movement_type_enum" NOT NULL, "qty" numeric(12,2) NOT NULL, "unit_cost_base" numeric(12,4) NOT NULL, "source_type" "public"."warehouse_movement_source_type_enum" NOT NULL, "source_id" uuid, "occurred_at" TIMESTAMP NOT NULL, "notes" text, "warehouse_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "grn_item_id" uuid, "reversal_of_id" uuid, CONSTRAINT "CHK_4a161e9bde3ac44412cf3ea5f2" CHECK (
	(
		(movement_type IN ('receipt', 'sale_return', 'transfer_in') AND qty > 0)
		OR
		(movement_type IN ('sale', 'supplier_return', 'write_off', 'transfer_out') AND qty < 0)
		OR
		movement_type = 'adjustment'
	)
), CONSTRAINT "CHK_f8456cae1a00926a62c305204e" CHECK ((qty <> 0)), CONSTRAINT "PK_ada0c8b59def45f8963523ffaf1" PRIMARY KEY ("id")); COMMENT ON COLUMN "warehouse_movement"."qty" IS 'Signed quantity; positive is inbound, negative is outbound'; COMMENT ON COLUMN "warehouse_movement"."unit_cost_base" IS 'Cost recognised per unit, in base currency, taken from the lot'; COMMENT ON COLUMN "warehouse_movement"."source_id" IS 'Row in the table named by source_type; no FK, the target varies'; COMMENT ON COLUMN "warehouse_movement"."occurred_at" IS 'When the stock physically moved'; COMMENT ON COLUMN "warehouse_movement"."reversal_of_id" IS 'The movement this one cancels out'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_movement_type" ON "warehouse_movement"  ("movement_type") `,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_warehouse_movement_reversal_of_id" ON "warehouse_movement"  ("reversal_of_id") WHERE reversal_of_id IS NOT NULL`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_movement_source" ON "warehouse_movement"  ("source_type", "source_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_movement_grn_item_id" ON "warehouse_movement"  ("grn_item_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_warehouse_movement_variant" ON "warehouse_movement"  ("warehouse_id", "variant_id", "occurred_at") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "warehouse_movement" IS 'Append-only ledger of physical stock changes; corrections are reversing rows, never edits'`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."stock_adjustment_reason_enum" AS ENUM('audit', 'damaged', 'expired', 'lost', 'theft', 'sample', 'found', 'sample_returned', 'return')`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."stock_adjustment_status_enum" AS ENUM('created', 'reversed')`,
		);
		await queryRunner.query(`CREATE TABLE "stock_adjustment" ("id" uuid NOT NULL DEFAULT uuidv7(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP DEFAULT now(), "deleted_at" TIMESTAMP, "reason" "public"."stock_adjustment_reason_enum" NOT NULL, "qty" numeric(12,2) NOT NULL, "status" "public"."stock_adjustment_status_enum" NOT NULL DEFAULT 'created', "reversed_at" TIMESTAMP, "notes" text, "warehouse_id" uuid NOT NULL, "variant_id" uuid NOT NULL, CONSTRAINT "CHK_ef13fdabf037f2316b12b895b6" CHECK (
	(
		(qty < 0 AND reason IN ('audit', 'damaged', 'expired', 'lost', 'theft', 'sample'))
		OR
		(qty > 0 AND reason IN ('audit', 'found', 'sample_returned', 'return'))
	)
), CONSTRAINT "PK_a140820a147913d91b4eb3b7e27" PRIMARY KEY ("id")); COMMENT ON COLUMN "stock_adjustment"."qty" IS 'Signed change posted to the lots; positive adds, negative removes'`);
		await queryRunner.query(
			`CREATE INDEX "IDX_stock_adjustment_variant_id" ON "stock_adjustment"  ("variant_id") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_stock_adjustment_warehouse_variant" ON "stock_adjustment"  ("warehouse_id", "variant_id") `,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "stock_adjustment" IS 'Stock added or removed by hand, with a reason; its warehouse_movement rows point back here'`,
		);
		await queryRunner.query(
			`CREATE TABLE "category_closure" ("id_ancestor" uuid NOT NULL, "id_descendant" uuid NOT NULL, CONSTRAINT "PK_8da8666fc72217687e9b4f4c7e9" PRIMARY KEY ("id_ancestor", "id_descendant"))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_4aa1348fc4b7da9bef0fae8ff4" ON "category_closure"  ("id_ancestor") `,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_6a22002acac4976977b1efd114" ON "category_closure"  ("id_descendant") `,
		);
		await queryRunner.query(
			`ALTER TABLE "address" ADD CONSTRAINT "FK_714a4ca3cfd66a718b5f7c3fee5" FOREIGN KEY ("city_id") REFERENCES "place"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article" ADD CONSTRAINT "FK_16d4ce4c84bd9b8562c6f396262" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_content" ADD CONSTRAINT "FK_695e2a3fb3e8f1995d703d5b91c" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "operational_record" ADD CONSTRAINT "FK_55d872f7ba7f7e7692375b1dcf0" FOREIGN KEY ("cash_flow_id") REFERENCES "cash_flow"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" ADD CONSTRAINT "FK_834b8e126ec58955db3a985edfb" FOREIGN KEY ("parent_id") REFERENCES "cash_flow"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "brand_content" ADD CONSTRAINT "FK_6699af3eb85f6ba17010c71167f" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "category" ADD CONSTRAINT "FK_1117b4fcb3cd4abb4383e1c2743" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "category_content" ADD CONSTRAINT "FK_c9c9c3b03be3b5d980ec8cee4ee" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" ADD CONSTRAINT "FK_3d8c00d2213b8fdefc2d18a11de" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" ADD CONSTRAINT "FK_5d748613d45a8988c741592de72" FOREIGN KEY ("address_id") REFERENCES "address"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client" ADD CONSTRAINT "FK_f18a6fabea7b2a90ab6bf10a650" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "complaint" ADD CONSTRAINT "FK_1ab3e07eb3ce33129dfb6d6af83" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "image_content" ADD CONSTRAINT "FK_c1718000e7e049b9841f8b4b222" FOREIGN KEY ("image_id") REFERENCES "image"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" ADD CONSTRAINT "FK_a0d9cbb7f4a017bac3198dd8ca0" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_c2dcbb1f285e8b596858aceb923" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" ADD CONSTRAINT "FK_a1f7f52f2f9a8a554ee3faa8a4a" FOREIGN KEY ("parent_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn" ADD CONSTRAINT "FK_b39d101f21c8bd2c6d4ef7349bf" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn" ADD CONSTRAINT "FK_bb6ef031a4087906372f630ec0b" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."mail_queue" ADD CONSTRAINT "FK_3871a34c42cb0ceaf17ee65bd6d" FOREIGN KEY ("template_id") REFERENCES "system"."template"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
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
			`ALTER TABLE "product" ADD CONSTRAINT "FK_2eb5ce4324613b4b457c364f4a2" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "place_content" ADD CONSTRAINT "FK_9f8efc4eaa0dadccb2a8f4794b1" FOREIGN KEY ("place_id") REFERENCES "place"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "place" ADD CONSTRAINT "FK_e8f42244c2d9143a42b13bd1d0c" FOREIGN KEY ("parent_id") REFERENCES "place"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "term_content" ADD CONSTRAINT "FK_bf1fac69ce1f37481f3134014de" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse" ADD CONSTRAINT "FK_e3166be4143d134babc789bef1c" FOREIGN KEY ("address_id") REFERENCES "address"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_permission" ADD CONSTRAINT "FK_2305dfa7330dd7f8e211f4f35d9" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_permission" ADD CONSTRAINT "FK_8a4d5521c1ced158c13438df3df" FOREIGN KEY ("permission_id") REFERENCES "system"."permission"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_category" ADD CONSTRAINT "FK_0f261c64d873b8dc5a26ecab44e" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_category" ADD CONSTRAINT "FK_20b9ebf3cb2834a02fd65fa0950" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_tag" ADD CONSTRAINT "FK_26455b396109a0b535ddb614832" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_tag" ADD CONSTRAINT "FK_cdc3f155737b763c298ab080f84" FOREIGN KEY ("tag_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_visibility_rule" ADD CONSTRAINT "FK_4a239efc040ebec82f2736f490a" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "discount_target" ADD CONSTRAINT "FK_30885c6f5e344c1affd5ac86d91" FOREIGN KEY ("discount_id") REFERENCES "discount"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn_item" ADD CONSTRAINT "FK_2f3398e4e3b6e493c3900c989b1" FOREIGN KEY ("grn_id") REFERENCES "grn"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn_item" ADD CONSTRAINT "FK_0f7afec9849383ec3e41e0c98c7" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
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
			`ALTER TABLE "invoice_line" ADD CONSTRAINT "FK_80102d263c514a8516640264744" FOREIGN KEY ("parent_line_id") REFERENCES "invoice_line"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_source" ADD CONSTRAINT "FK_0d3a5605e616742b2f62cae529c" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD CONSTRAINT "FK_ed8fae6d7239e9d730219215af7" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD CONSTRAINT "FK_e67ffe518d35eaa81833836b3bb" FOREIGN KEY ("parent_id") REFERENCES "order_line"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD CONSTRAINT "FK_94764545270d2b42e8f6705c681" FOREIGN KEY ("bundle_item_id") REFERENCES "product_bundle_item"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" ADD CONSTRAINT "FK_aec0fb36aff8abc5db26f27a6df" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return_line" ADD CONSTRAINT "FK_66581b540faf934d9e2b84a866b" FOREIGN KEY ("order_return_id") REFERENCES "order_return"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return_line" ADD CONSTRAINT "FK_4caaf0fd5b76203af0609a8896f" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_attribute" ADD CONSTRAINT "FK_c8f119684d209b55cf5e8b42532" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_attribute" ADD CONSTRAINT "FK_c7b5ed8e690ecc7758ecd515844" FOREIGN KEY ("attribute_label_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_attribute" ADD CONSTRAINT "FK_ebca7f2c5f70c7988c09256c327" FOREIGN KEY ("value_term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_availability" ADD CONSTRAINT "FK_0cb457dbee5bb4cfe9ffb1ce01b" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_group" ADD CONSTRAINT "FK_b27dcfe0bbadcba2a4c9dd236de" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_group" ADD CONSTRAINT "FK_263ebca8a1a834f257faee33318" FOREIGN KEY ("label_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item_price" ADD CONSTRAINT "FK_acfab32b10d24fe85d0b91b996c" FOREIGN KEY ("item_id") REFERENCES "product_bundle_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item" ADD CONSTRAINT "FK_facd66e71c7e4d1de72eead5dee" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item" ADD CONSTRAINT "FK_a5bc9f40d7b103573d5d18f9d93" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item" ADD CONSTRAINT "FK_702709f0297263e9fc92c7c1dc2" FOREIGN KEY ("group_id") REFERENCES "product_bundle_group"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute_option" ADD CONSTRAINT "FK_faf5f9bb3eb451aa8e8fc8623aa" FOREIGN KEY ("attribute_id") REFERENCES "product_category_attribute"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute_option" ADD CONSTRAINT "FK_cd9a281c5902ff59b0d1959cd5c" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute" ADD CONSTRAINT "FK_4965e459a87464b19a3a6faa0f4" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute" ADD CONSTRAINT "FK_bd3057258005075780251b33912" FOREIGN KEY ("attribute_label_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category" ADD CONSTRAINT "FK_0374879a971928bc3f57eed0a59" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category" ADD CONSTRAINT "FK_2df1f83329c00e6eadde0493e16" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_content" ADD CONSTRAINT "FK_f768662205b901ba35c9c9255a0" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_group" ADD CONSTRAINT "FK_28f273fec3a8f15a46494a1e5cf" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_group" ADD CONSTRAINT "FK_cf86995180ef72ced0a9882794b" FOREIGN KEY ("label_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_price" ADD CONSTRAINT "FK_ad2662418d092bff5d7cd1ee397" FOREIGN KEY ("option_id") REFERENCES "product_option"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option" ADD CONSTRAINT "FK_882a199b6bdc3da9a251729946d" FOREIGN KEY ("option_group_id") REFERENCES "product_option_group"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option" ADD CONSTRAINT "FK_eba1e720c51c6065fb8a2a6d048" FOREIGN KEY ("label_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_price" ADD CONSTRAINT "FK_4c512b620f7bb9a8373a2f53f0a" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant_attribute" ADD CONSTRAINT "FK_d5dbceb5e426cd9622a029e7678" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant_attribute" ADD CONSTRAINT "FK_cff394fbfce8128dd4ff7d9c7c9" FOREIGN KEY ("attribute_label_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant_attribute" ADD CONSTRAINT "FK_751b01e4f321fcc21c0bd9873c8" FOREIGN KEY ("value_term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant" ADD CONSTRAINT "FK_ca67dd080aac5ecf99609960cd2" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" ADD CONSTRAINT "FK_de29bf9df8e9e33b4a69495c0e0" FOREIGN KEY ("shipping_id") REFERENCES "shipping"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" ADD CONSTRAINT "FK_86ae0066a568d3f46f4633f0d6b" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_tag" ADD CONSTRAINT "FK_d08cb260c60a9bf0a5e0424768d" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_tag" ADD CONSTRAINT "FK_7bf0b673c19b33c9456d54b2b37" FOREIGN KEY ("tag_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" ADD CONSTRAINT "FK_5dede093a15bc721f40e607fe90" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" ADD CONSTRAINT "FK_81d2720c41ad4d1fdaa78726ff2" FOREIGN KEY ("cash_flow_id") REFERENCES "cash_flow"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."account_identity" ADD CONSTRAINT "FK_51838685440a76e0e0495225836" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."account_token" ADD CONSTRAINT "FK_ab3c66669facfe429164e60ab82" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."account_recovery" ADD CONSTRAINT "FK_604c2b655029e47091f671ba875" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD CONSTRAINT "FK_b6b2a4f1f533d89d218e70db941" FOREIGN KEY ("cart_id") REFERENCES "cart"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD CONSTRAINT "FK_43f27725946a4c26b83b0a18655" FOREIGN KEY ("parent_id") REFERENCES "cart_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD CONSTRAINT "FK_6fbef1dc37459d6dc249e1ec815" FOREIGN KEY ("bundle_item_id") REFERENCES "product_bundle_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" ADD CONSTRAINT "FK_3158a86c48be17298271fabd2b0" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "FK_ffdce5dc3204f23722ddf97c912" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" ADD CONSTRAINT "FK_a9d41061b39e0be6044df6bd6da" FOREIGN KEY ("cash_flow_id") REFERENCES "cash_flow"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart" ADD CONSTRAINT "FK_f091e86a234693a49084b4c2c86" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "comment" ADD CONSTRAINT "FK_8bd8d0985c0d077c8129fb4a209" FOREIGN KEY ("parent_id") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "comment" ADD CONSTRAINT "FK_bbfe153fa60aa06483ed35ff4a7" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "logs"."log_history" ADD CONSTRAINT "FK_4daa26d01591f9e64dd97670ea4" FOREIGN KEY ("auth_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "rating" ADD CONSTRAINT "FK_17618c8d69b7e2e287bf9f8fbb3" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" ADD CONSTRAINT "FK_26b533e15b5f2334c96339a1f08" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" ADD CONSTRAINT "FK_f524b9034cb0e4297fc181ae985" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variant"("id","product_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" ADD CONSTRAINT "FK_d816563052236db6adc852f90ee" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" ADD CONSTRAINT "FK_81446f2ee100305f42645d4d6c2" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription_evidence" ADD CONSTRAINT "FK_cc9eb4c92df6a79526d30655c1f" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription_evidence" ADD CONSTRAINT "FK_ce67597df9377e2f93ef86c667a" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" ADD CONSTRAINT "FK_9a5c151a1eb06bfb35e07649cee" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" ADD CONSTRAINT "FK_0b7592b1107e4088a2a173f77ef" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription" ADD CONSTRAINT "FK_32ddbd23837b1229248a5cc232b" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription" ADD CONSTRAINT "FK_940d49a105d50bbd616be540013" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" ADD CONSTRAINT "FK_86a8405bfc8c1087da14dfb6b70" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" ADD CONSTRAINT "FK_2b2eaee830c2e18b9e088b08c80" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" ADD CONSTRAINT "FK_3a0efe99501904a3a344758fd76" FOREIGN KEY ("grn_item_id") REFERENCES "grn_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" ADD CONSTRAINT "FK_d3db5c12224d6e37d73e4f458a7" FOREIGN KEY ("reversal_of_id") REFERENCES "warehouse_movement"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_adjustment" ADD CONSTRAINT "FK_c51e024f2f3111a18d88bdfdaf4" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_adjustment" ADD CONSTRAINT "FK_3a5138201295e437439d9ed0dcd" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "category_closure" ADD CONSTRAINT "FK_4aa1348fc4b7da9bef0fae8ff48" FOREIGN KEY ("id_ancestor") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "category_closure" ADD CONSTRAINT "FK_6a22002acac4976977b1efd114a" FOREIGN KEY ("id_descendant") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);

		/*
		 * Hand-written, so a regenerated migration has to carry it over: `@Index` describes plain
		 * column lists, and none of these is one. The first three back the full-text
		 * `filterByTerm` of their tables - an expression over `to_tsvector`, which a query matches
		 * only when it repeats the expression verbatim. Without them every search still answers
		 * correctly, through a sequential scan; without the last, a second interval on the same
		 * day is no longer refused.
		 */
		await queryRunner.query(
			`CREATE INDEX "IDX_place_content_name_search" ON "place_content" USING GIN (to_tsvector('simple', COALESCE("name", '')))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_article_content_search" ON "article_content" USING GIN (to_tsvector('simple', COALESCE("title", '') || ' ' || COALESCE("brief", '')))`,
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_product_content_search" ON "product_content" USING GIN (to_tsvector('simple', COALESCE("label", '') || ' ' || COALESCE("description", '')))`,
		);

		// `lower(sku) LIKE lower(:term)` - the SKU prefix search of the product and variant lists
		await queryRunner.query(
			`CREATE INDEX "IDX_product_variant_sku_prefix" ON "product_variant" (lower("sku") text_pattern_ops) WHERE deleted_at IS NULL`,
		);
		// One interval per product per day; `NULLS NOT DISTINCT` makes "every day" (null) count too
		await queryRunner.query(
			`CREATE UNIQUE INDEX "IDX_product_availability_day_unique" ON "product_availability" ("product_id", "day_of_week") NULLS NOT DISTINCT WHERE deleted_at IS NULL`,
		);

		/*
		 * Reference rows a fresh database needs before any seed runs: the Romanian VAT schedule
		 * pricing reads, and the series a buyer's return request is numbered from.
		 */
		await queryRunner.query(
			`INSERT INTO "vat_rate" ("country_code", "category", "rate", "valid_from", "notes") VALUES
                ('RO', 'standard', 19, '2017-01-01', 'Fiscal Code, Law 227/2015'),
                ('RO', 'reduced', 9, '2017-01-01', 'Fiscal Code, Law 227/2015 - food and restaurant service'),
                ('RO', 'second_reduced', 5, '2017-01-01', 'Fiscal Code, Law 227/2015'),
                ('RO', 'standard', 21, '2025-08-01', 'Law 141/2025 - alcohol, NC 2202 sweetened drinks'),
                ('RO', 'reduced', 11, '2025-08-01', 'Law 141/2025 - food and non-alcoholic restaurant service'),
                ('RO', 'second_reduced', 11, '2025-08-01', 'Law 141/2025 - the 5% class folds into 11%')`,
		);
		await queryRunner.query(
			`INSERT INTO "document_series" ("document_type", "code")
             SELECT 'order_return', 'RMA'
             WHERE NOT EXISTS (
               SELECT 1 FROM "document_series" WHERE "document_type" = 'order_return'
             )`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "category_closure" DROP CONSTRAINT "FK_6a22002acac4976977b1efd114a"`,
		);
		await queryRunner.query(
			`ALTER TABLE "category_closure" DROP CONSTRAINT "FK_4aa1348fc4b7da9bef0fae8ff48"`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_adjustment" DROP CONSTRAINT "FK_3a5138201295e437439d9ed0dcd"`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_adjustment" DROP CONSTRAINT "FK_c51e024f2f3111a18d88bdfdaf4"`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" DROP CONSTRAINT "FK_d3db5c12224d6e37d73e4f458a7"`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" DROP CONSTRAINT "FK_3a0efe99501904a3a344758fd76"`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" DROP CONSTRAINT "FK_2b2eaee830c2e18b9e088b08c80"`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse_movement" DROP CONSTRAINT "FK_86a8405bfc8c1087da14dfb6b70"`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription" DROP CONSTRAINT "FK_940d49a105d50bbd616be540013"`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription" DROP CONSTRAINT "FK_32ddbd23837b1229248a5cc232b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" DROP CONSTRAINT "FK_0b7592b1107e4088a2a173f77ef"`,
		);
		await queryRunner.query(
			`ALTER TABLE "stock_reservation" DROP CONSTRAINT "FK_9a5c151a1eb06bfb35e07649cee"`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription_evidence" DROP CONSTRAINT "FK_ce67597df9377e2f93ef86c667a"`,
		);
		await queryRunner.query(
			`ALTER TABLE "subscription_evidence" DROP CONSTRAINT "FK_cc9eb4c92df6a79526d30655c1f"`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" DROP CONSTRAINT "FK_81446f2ee100305f42645d4d6c2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" DROP CONSTRAINT "FK_d816563052236db6adc852f90ee"`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" DROP CONSTRAINT "FK_f524b9034cb0e4297fc181ae985"`,
		);
		await queryRunner.query(
			`ALTER TABLE "review" DROP CONSTRAINT "FK_26b533e15b5f2334c96339a1f08"`,
		);
		await queryRunner.query(
			`ALTER TABLE "rating" DROP CONSTRAINT "FK_17618c8d69b7e2e287bf9f8fbb3"`,
		);
		await queryRunner.query(
			`ALTER TABLE "logs"."log_history" DROP CONSTRAINT "FK_4daa26d01591f9e64dd97670ea4"`,
		);
		await queryRunner.query(
			`ALTER TABLE "comment" DROP CONSTRAINT "FK_bbfe153fa60aa06483ed35ff4a7"`,
		);
		await queryRunner.query(
			`ALTER TABLE "comment" DROP CONSTRAINT "FK_8bd8d0985c0d077c8129fb4a209"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart" DROP CONSTRAINT "FK_f091e86a234693a49084b4c2c86"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "FK_a9d41061b39e0be6044df6bd6da"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_ledger" DROP CONSTRAINT "FK_ffdce5dc3204f23722ddf97c912"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP CONSTRAINT "FK_3158a86c48be17298271fabd2b0"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP CONSTRAINT "FK_6fbef1dc37459d6dc249e1ec815"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP CONSTRAINT "FK_43f27725946a4c26b83b0a18655"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cart_item" DROP CONSTRAINT "FK_b6b2a4f1f533d89d218e70db941"`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."account_recovery" DROP CONSTRAINT "FK_604c2b655029e47091f671ba875"`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."account_token" DROP CONSTRAINT "FK_ab3c66669facfe429164e60ab82"`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."account_identity" DROP CONSTRAINT "FK_51838685440a76e0e0495225836"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" DROP CONSTRAINT "FK_81d2720c41ad4d1fdaa78726ff2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_payment" DROP CONSTRAINT "FK_5dede093a15bc721f40e607fe90"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_tag" DROP CONSTRAINT "FK_7bf0b673c19b33c9456d54b2b37"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_tag" DROP CONSTRAINT "FK_d08cb260c60a9bf0a5e0424768d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" DROP CONSTRAINT "FK_86ae0066a568d3f46f4633f0d6b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping_line" DROP CONSTRAINT "FK_de29bf9df8e9e33b4a69495c0e0"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant" DROP CONSTRAINT "FK_ca67dd080aac5ecf99609960cd2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant_attribute" DROP CONSTRAINT "FK_751b01e4f321fcc21c0bd9873c8"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant_attribute" DROP CONSTRAINT "FK_cff394fbfce8128dd4ff7d9c7c9"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variant_attribute" DROP CONSTRAINT "FK_d5dbceb5e426cd9622a029e7678"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_price" DROP CONSTRAINT "FK_4c512b620f7bb9a8373a2f53f0a"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option" DROP CONSTRAINT "FK_eba1e720c51c6065fb8a2a6d048"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option" DROP CONSTRAINT "FK_882a199b6bdc3da9a251729946d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_price" DROP CONSTRAINT "FK_ad2662418d092bff5d7cd1ee397"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_group" DROP CONSTRAINT "FK_cf86995180ef72ced0a9882794b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_option_group" DROP CONSTRAINT "FK_28f273fec3a8f15a46494a1e5cf"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_content" DROP CONSTRAINT "FK_f768662205b901ba35c9c9255a0"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category" DROP CONSTRAINT "FK_2df1f83329c00e6eadde0493e16"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category" DROP CONSTRAINT "FK_0374879a971928bc3f57eed0a59"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute" DROP CONSTRAINT "FK_bd3057258005075780251b33912"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute" DROP CONSTRAINT "FK_4965e459a87464b19a3a6faa0f4"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute_option" DROP CONSTRAINT "FK_cd9a281c5902ff59b0d1959cd5c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_category_attribute_option" DROP CONSTRAINT "FK_faf5f9bb3eb451aa8e8fc8623aa"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item" DROP CONSTRAINT "FK_702709f0297263e9fc92c7c1dc2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item" DROP CONSTRAINT "FK_a5bc9f40d7b103573d5d18f9d93"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item" DROP CONSTRAINT "FK_facd66e71c7e4d1de72eead5dee"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_item_price" DROP CONSTRAINT "FK_acfab32b10d24fe85d0b91b996c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_group" DROP CONSTRAINT "FK_263ebca8a1a834f257faee33318"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_bundle_group" DROP CONSTRAINT "FK_b27dcfe0bbadcba2a4c9dd236de"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_availability" DROP CONSTRAINT "FK_0cb457dbee5bb4cfe9ffb1ce01b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_attribute" DROP CONSTRAINT "FK_ebca7f2c5f70c7988c09256c327"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_attribute" DROP CONSTRAINT "FK_c7b5ed8e690ecc7758ecd515844"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_attribute" DROP CONSTRAINT "FK_c8f119684d209b55cf5e8b42532"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return_line" DROP CONSTRAINT "FK_4caaf0fd5b76203af0609a8896f"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return_line" DROP CONSTRAINT "FK_66581b540faf934d9e2b84a866b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP CONSTRAINT "FK_aec0fb36aff8abc5db26f27a6df"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP CONSTRAINT "FK_94764545270d2b42e8f6705c681"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP CONSTRAINT "FK_e67ffe518d35eaa81833836b3bb"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_line" DROP CONSTRAINT "FK_ed8fae6d7239e9d730219215af7"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_source" DROP CONSTRAINT "FK_0d3a5605e616742b2f62cae529c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice_line" DROP CONSTRAINT "FK_80102d263c514a8516640264744"`,
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
			`ALTER TABLE "grn_item" DROP CONSTRAINT "FK_0f7afec9849383ec3e41e0c98c7"`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn_item" DROP CONSTRAINT "FK_2f3398e4e3b6e493c3900c989b1"`,
		);
		await queryRunner.query(
			`ALTER TABLE "discount_target" DROP CONSTRAINT "FK_30885c6f5e344c1affd5ac86d91"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_visibility_rule" DROP CONSTRAINT "FK_4a239efc040ebec82f2736f490a"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_tag" DROP CONSTRAINT "FK_cdc3f155737b763c298ab080f84"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_tag" DROP CONSTRAINT "FK_26455b396109a0b535ddb614832"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_category" DROP CONSTRAINT "FK_20b9ebf3cb2834a02fd65fa0950"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_category" DROP CONSTRAINT "FK_0f261c64d873b8dc5a26ecab44e"`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_permission" DROP CONSTRAINT "FK_8a4d5521c1ced158c13438df3df"`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_permission" DROP CONSTRAINT "FK_2305dfa7330dd7f8e211f4f35d9"`,
		);
		await queryRunner.query(
			`ALTER TABLE "warehouse" DROP CONSTRAINT "FK_e3166be4143d134babc789bef1c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "term_content" DROP CONSTRAINT "FK_bf1fac69ce1f37481f3134014de"`,
		);
		await queryRunner.query(
			`ALTER TABLE "place" DROP CONSTRAINT "FK_e8f42244c2d9143a42b13bd1d0c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "place_content" DROP CONSTRAINT "FK_9f8efc4eaa0dadccb2a8f4794b1"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product" DROP CONSTRAINT "FK_2eb5ce4324613b4b457c364f4a2"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP CONSTRAINT "FK_881e1fddbdfd46691d6c1cd49e6"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP CONSTRAINT "FK_bd7ae170286f40bb04c2b261640"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP CONSTRAINT "FK_8cd14c6bba09f1f387c7b94976c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP CONSTRAINT "FK_d4cff73dcaa06e959cce8295816"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP CONSTRAINT "FK_d69b5df160de61199dcc793d3ee"`,
		);
		await queryRunner.query(
			`ALTER TABLE "shipping" DROP CONSTRAINT "FK_a37456893780ce2dfe0a7484c22"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return" DROP CONSTRAINT "FK_bedde5994142b88558a0dd95bca"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return" DROP CONSTRAINT "FK_6026be6cb11ad737782f5f720aa"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order_return" DROP CONSTRAINT "FK_f2c6ae4d507d369652bbe6e4a04"`,
		);
		await queryRunner.query(
			`ALTER TABLE "system"."mail_queue" DROP CONSTRAINT "FK_3871a34c42cb0ceaf17ee65bd6d"`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn" DROP CONSTRAINT "FK_bb6ef031a4087906372f630ec0b"`,
		);
		await queryRunner.query(
			`ALTER TABLE "grn" DROP CONSTRAINT "FK_b39d101f21c8bd2c6d4ef7349bf"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_a1f7f52f2f9a8a554ee3faa8a4a"`,
		);
		await queryRunner.query(
			`ALTER TABLE "invoice" DROP CONSTRAINT "FK_c2dcbb1f285e8b596858aceb923"`,
		);
		await queryRunner.query(
			`ALTER TABLE "order" DROP CONSTRAINT "FK_a0d9cbb7f4a017bac3198dd8ca0"`,
		);
		await queryRunner.query(
			`ALTER TABLE "image_content" DROP CONSTRAINT "FK_c1718000e7e049b9841f8b4b222"`,
		);
		await queryRunner.query(
			`ALTER TABLE "complaint" DROP CONSTRAINT "FK_1ab3e07eb3ce33129dfb6d6af83"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client" DROP CONSTRAINT "FK_f18a6fabea7b2a90ab6bf10a650"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" DROP CONSTRAINT "FK_5d748613d45a8988c741592de72"`,
		);
		await queryRunner.query(
			`ALTER TABLE "client_address" DROP CONSTRAINT "FK_3d8c00d2213b8fdefc2d18a11de"`,
		);
		await queryRunner.query(
			`ALTER TABLE "category_content" DROP CONSTRAINT "FK_c9c9c3b03be3b5d980ec8cee4ee"`,
		);
		await queryRunner.query(
			`ALTER TABLE "category" DROP CONSTRAINT "FK_1117b4fcb3cd4abb4383e1c2743"`,
		);
		await queryRunner.query(
			`ALTER TABLE "brand_content" DROP CONSTRAINT "FK_6699af3eb85f6ba17010c71167f"`,
		);
		await queryRunner.query(
			`ALTER TABLE "cash_flow" DROP CONSTRAINT "FK_834b8e126ec58955db3a985edfb"`,
		);
		await queryRunner.query(
			`ALTER TABLE "operational_record" DROP CONSTRAINT "FK_55d872f7ba7f7e7692375b1dcf0"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article_content" DROP CONSTRAINT "FK_695e2a3fb3e8f1995d703d5b91c"`,
		);
		await queryRunner.query(
			`ALTER TABLE "article" DROP CONSTRAINT "FK_16d4ce4c84bd9b8562c6f396262"`,
		);
		await queryRunner.query(
			`ALTER TABLE "address" DROP CONSTRAINT "FK_714a4ca3cfd66a718b5f7c3fee5"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_6a22002acac4976977b1efd114"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_4aa1348fc4b7da9bef0fae8ff4"`,
		);
		await queryRunner.query(`DROP TABLE "category_closure"`);
		await queryRunner.query(`COMMENT ON TABLE "stock_adjustment" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_stock_adjustment_warehouse_variant"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_stock_adjustment_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "stock_adjustment"`);
		await queryRunner.query(
			`DROP TYPE "public"."stock_adjustment_status_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."stock_adjustment_reason_enum"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "warehouse_movement" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_variant"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_grn_item_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_source"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_reversal_of_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_movement_type"`,
		);
		await queryRunner.query(`DROP TABLE "warehouse_movement"`);
		await queryRunner.query(
			`DROP TYPE "public"."warehouse_movement_source_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."warehouse_movement_movement_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "subscription" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_end_at"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_status"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_ref_code"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_user_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_order_id"`,
		);
		await queryRunner.query(`DROP TABLE "subscription"`);
		await queryRunner.query(
			`DROP TYPE "public"."subscription_status_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "stock_reservation" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_stock_reservation_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_stock_reservation_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "stock_reservation"`);
		await queryRunner.query(
			`COMMENT ON TABLE "subscription_evidence" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_evidence_status"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_evidence_invoice_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_subscription_evidence_subscription_id"`,
		);
		await queryRunner.query(`DROP TABLE "subscription_evidence"`);
		await queryRunner.query(
			`DROP TYPE "public"."subscription_evidence_status_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "review" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_review_product"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_review_product_rating"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_review_moderation"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_review_user_status"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_review_order"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_review_variant"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_review_user"`);
		await queryRunner.query(`DROP TABLE "review"`);
		await queryRunner.query(`DROP TYPE "public"."review_status_enum"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_rating_ip"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_rating_user"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_rating_entity"`);
		await queryRunner.query(`DROP TABLE "rating"`);
		await queryRunner.query(`DROP TYPE "public"."rating_reaction_enum"`);
		await queryRunner.query(`DROP TYPE "public"."rating_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."rating_entity_type_enum"`);
		await queryRunner.query(
			`COMMENT ON TABLE "logs"."log_history" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "logs"."IDX_log_history_entity_id_action"`,
		);
		await queryRunner.query(
			`DROP INDEX "logs"."IDX_log_history_recorded_at"`,
		);
		await queryRunner.query(`DROP INDEX "logs"."IDX_log_history_source"`);
		await queryRunner.query(
			`DROP INDEX "logs"."IDX_log_history_request_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "logs"."IDX_log_history_performed_by"`,
		);
		await queryRunner.query(`DROP INDEX "logs"."IDX_log_history_auth_id"`);
		await queryRunner.query(`DROP TABLE "logs"."log_history"`);
		await queryRunner.query(
			`COMMENT ON TABLE "logs"."cron_history" IS NULL`,
		);
		await queryRunner.query(`DROP INDEX "logs"."IDX_cron_history_status"`);
		await queryRunner.query(
			`DROP INDEX "logs"."IDX_cron_history_start_at"`,
		);
		await queryRunner.query(`DROP TABLE "logs"."cron_history"`);
		await queryRunner.query(`DROP TYPE "logs"."cron_history_status_enum"`);
		await queryRunner.query(
			`DROP INDEX "public"."UQ_comment_subscription_user"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."UQ_comment_subscription_token"`,
		);
		await queryRunner.query(`DROP TABLE "comment_subscription"`);
		await queryRunner.query(
			`DROP TYPE "public"."comment_subscription_notification_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."comment_subscription_entity_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "comment" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_comment_entity"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_comment_moderation"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_comment_user_status"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_comment_user_ip_hash"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_comment_notify_pending"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_comment_parent_id"`);
		await queryRunner.query(`DROP TABLE "comment"`);
		await queryRunner.query(`DROP TYPE "public"."comment_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."comment_type_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."comment_entity_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "cart" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_user"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_cart_expires_at"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_token"`);
		await queryRunner.query(`DROP TABLE "cart"`);
		await queryRunner.query(`COMMENT ON TABLE "client_ledger" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_ledger_client_currency"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_ledger_cash_flow"`,
		);
		await queryRunner.query(`DROP TABLE "client_ledger"`);
		await queryRunner.query(
			`DROP TYPE "public"."client_ledger_entry_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "cart_item" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_line"`);
		await queryRunner.query(`DROP INDEX "public"."UQ_cart_item_component"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cart_item_parent_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cart_item_variant_id"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_cart_item_cart_id"`);
		await queryRunner.query(`DROP TABLE "cart_item"`);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."account_recovery" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_account_recovery_ident"`,
		);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_account_recovery_user_id"`,
		);
		await queryRunner.query(`DROP TABLE "system"."account_recovery"`);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."account_token" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_account_token_ident"`,
		);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_account_token_user_id"`,
		);
		await queryRunner.query(`DROP TABLE "system"."account_token"`);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."account_identity" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_account_identity_provider_subject"`,
		);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_account_identity_user_provider"`,
		);
		await queryRunner.query(`DROP TABLE "system"."account_identity"`);
		await queryRunner.query(
			`DROP TYPE "system"."account_identity_provider_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "invoice_payment" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_payment_pair"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_payment_cash_flow_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_payment_invoice_id"`,
		);
		await queryRunner.query(`DROP TABLE "invoice_payment"`);
		await queryRunner.query(`COMMENT ON TABLE "product_tag" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_product_tag_unique"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_tag_product_id"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_product_tag_tag_id"`);
		await queryRunner.query(`DROP TABLE "product_tag"`);
		await queryRunner.query(`COMMENT ON TABLE "shipping_line" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_line_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_line_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_line_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "shipping_line"`);
		await queryRunner.query(
			`DROP TYPE "public"."shipping_line_condition_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "product_variant" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_id_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_default"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_barcode"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_sku"`,
		);
		await queryRunner.query(`DROP TABLE "product_variant"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_variant_attribute" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_attribute_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_attribute_numeric_facet"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_attribute_term_facet"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_attribute_value_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_attribute_label_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_variant_attribute_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_variant_attribute"`);
		await queryRunner.query(`COMMENT ON TABLE "product_price" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_price_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_price_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_price"`);
		await queryRunner.query(`COMMENT ON TABLE "product_option" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_group_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_label_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_default"`,
		);
		await queryRunner.query(`DROP TABLE "product_option"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_option_price" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_price_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_price_option_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_option_price"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_option_group" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_group_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_option_group_label_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_option_group"`);
		await queryRunner.query(`COMMENT ON TABLE "product_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_content_unique_per_lang"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_content_slug_lang"`,
		);
		await queryRunner.query(`DROP TABLE "product_content"`);
		await queryRunner.query(`COMMENT ON TABLE "product_category" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_category_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_category"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_category_attribute" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_attribute_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_attribute_category_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_attribute_label_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_category_attribute"`);
		await queryRunner.query(
			`DROP TYPE "public"."product_category_attribute_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."product_category_attribute_value_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."product_category_attribute_scope_enum"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_category_attribute_option" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_attribute_option_attribute_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_attribute_option_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_category_attribute_option_term_id"`,
		);
		await queryRunner.query(
			`DROP TABLE "product_category_attribute_option"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "product_bundle_item" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_item_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_item_variant_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_item_group_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_item_default"`,
		);
		await queryRunner.query(`DROP TABLE "product_bundle_item"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_bundle_item_price" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_item_price_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_item_price_item_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_bundle_item_price"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_bundle_group" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_group_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_bundle_group_label_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_bundle_group"`);
		await queryRunner.query(
			`COMMENT ON TABLE "product_availability" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_availability_product_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_availability"`);
		await queryRunner.query(`COMMENT ON TABLE "product_attribute" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_unique_scalar"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_numeric_facet"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_term_facet"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_attribute_value_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_attribute_label_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_attribute_product_id"`,
		);
		await queryRunner.query(`DROP TABLE "product_attribute"`);
		await queryRunner.query(`COMMENT ON TABLE "order_return_line" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_return_line_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_return_line_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "order_return_line"`);
		await queryRunner.query(`COMMENT ON TABLE "order_line" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_line_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_line_variant_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_line_parent_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_line_order_id"`,
		);
		await queryRunner.query(`DROP TABLE "order_line"`);
		await queryRunner.query(`COMMENT ON TABLE "invoice_source" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_source_invoice"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_source_target"`,
		);
		await queryRunner.query(`DROP TABLE "invoice_source"`);
		await queryRunner.query(
			`DROP TYPE "public"."invoice_source_source_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "invoice_line" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_line_product_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_line_parent_line_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_line_shipping_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_line_order_line_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_line_invoice_id"`,
		);
		await queryRunner.query(`DROP TABLE "invoice_line"`);
		await queryRunner.query(`DROP TYPE "public"."invoice_line_kind_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "grn_item" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_grn_item_unique"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_grn_item_variant_open"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_grn_item_variant_id"`,
		);
		await queryRunner.query(`DROP TABLE "grn_item"`);
		await queryRunner.query(`COMMENT ON TABLE "discount_target" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_discount_target_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_discount_target_entity"`,
		);
		await queryRunner.query(`DROP TABLE "discount_target"`);
		await queryRunner.query(
			`DROP TYPE "public"."discount_target_target_type_enum"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "article_visibility_rule" IS NULL`,
		);
		await queryRunner.query(`DROP TABLE "article_visibility_rule"`);
		await queryRunner.query(`COMMENT ON TABLE "article_tag" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_article_tag_unique"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_article_tag_tag_id"`);
		await queryRunner.query(`DROP TABLE "article_tag"`);
		await queryRunner.query(`COMMENT ON TABLE "article_category" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_article_category_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_article_category_category_id"`,
		);
		await queryRunner.query(`DROP TABLE "article_category"`);
		await queryRunner.query(`COMMENT ON TABLE "user_permission" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_user_permission_permission"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_user_permission_permission_id"`,
		);
		await queryRunner.query(`DROP TABLE "user_permission"`);
		await queryRunner.query(`COMMENT ON TABLE "warehouse" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_warehouse_default"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_warehouse_status"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_warehouse_name"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_warehouse_code"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_warehouse_address_id"`,
		);
		await queryRunner.query(`DROP TABLE "warehouse"`);
		await queryRunner.query(`DROP TYPE "public"."warehouse_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "vendor" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_vendor_status"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_vendor_type"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_vendor_name"`);
		await queryRunner.query(`DROP TABLE "vendor"`);
		await queryRunner.query(`DROP TYPE "public"."vendor_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."vendor_type_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "term" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_term_type"`);
		await queryRunner.query(`DROP TABLE "term"`);
		await queryRunner.query(`DROP TYPE "public"."term_type_enum"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_user_email"`);
		await queryRunner.query(`DROP TABLE "user"`);
		await queryRunner.query(`DROP TYPE "public"."user_operator_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
		await queryRunner.query(`DROP TYPE "public"."user_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "term_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_term_content_unique_per_lang"`,
		);
		await queryRunner.query(`DROP TABLE "term_content"`);
		await queryRunner.query(`COMMENT ON TABLE "place" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_place_code"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_place_parent_id"`);
		await queryRunner.query(`DROP TABLE "place"`);
		await queryRunner.query(`DROP TYPE "public"."place_place_type_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "place_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_place_content_unique_per_lang"`,
		);
		await queryRunner.query(`DROP TABLE "place_content"`);
		await queryRunner.query(`COMMENT ON TABLE "product" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_available_from"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_available_until"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_product_discontinued_at"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_product_brand_id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_product_workflow"`);
		await queryRunner.query(`DROP TABLE "product"`);
		await queryRunner.query(`DROP TYPE "public"."product_unit_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."product_composition_enum"`,
		);
		await queryRunner.query(`DROP TYPE "public"."product_type_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."product_sale_status_enum"`,
		);
		await queryRunner.query(`DROP TYPE "public"."product_workflow_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "vat_rate" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_vat_rate_unique"`);
		await queryRunner.query(`DROP TABLE "vat_rate"`);
		await queryRunner.query(`COMMENT ON TABLE "shipping" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_tracking_number"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_destination_client_address_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_destination_warehouse_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_pickup_client_address_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_pickup_warehouse_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_carrier_id"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_shipping_method"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_shipping_status"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_shipping_document_ref"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_shipping_order_id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_shipping_scope"`);
		await queryRunner.query(`DROP TABLE "shipping"`);
		await queryRunner.query(`DROP TYPE "public"."shipping_method_enum"`);
		await queryRunner.query(`DROP TYPE "public"."shipping_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."shipping_scope_enum"`);
		await queryRunner.query(
			`COMMENT ON TABLE "system"."permission" IS NULL`,
		);
		await queryRunner.query(`DROP INDEX "system"."IDX_permission"`);
		await queryRunner.query(`DROP TABLE "system"."permission"`);
		await queryRunner.query(`COMMENT ON TABLE "order_return" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_order_return_ref"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_return_order_status"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_return_status"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_return_shipping_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_order_return_user_id"`,
		);
		await queryRunner.query(`DROP TABLE "order_return"`);
		await queryRunner.query(
			`DROP TYPE "public"."order_return_reason_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."order_return_status_enum"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_image_type_id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_image_storage"`);
		await queryRunner.query(`DROP TABLE "image"`);
		await queryRunner.query(`DROP TYPE "public"."image_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."image_storage_enum"`);
		await queryRunner.query(`DROP TYPE "public"."image_image_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."image_section_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "system"."template" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_label_language_type"`,
		);
		await queryRunner.query(`DROP TABLE "system"."template"`);
		await queryRunner.query(`DROP TYPE "system"."template_type_enum"`);
		await queryRunner.query(`DROP INDEX "logs"."IDX_log_data"`);
		await queryRunner.query(`DROP INDEX "logs"."IDX_log_data_request_id"`);
		await queryRunner.query(`DROP INDEX "logs"."IDX_log_data_pid"`);
		await queryRunner.query(`DROP TABLE "logs"."log_data"`);
		await queryRunner.query(`DROP TYPE "logs"."log_data_level_enum"`);
		await queryRunner.query(`DROP TYPE "logs"."log_data_category_enum"`);
		await queryRunner.query(`DROP INDEX "system"."IDX_mail_queue_sent_at"`);
		await queryRunner.query(`DROP INDEX "system"."IDX_mail_queue_status"`);
		await queryRunner.query(
			`DROP INDEX "system"."IDX_mail_queue_template_id"`,
		);
		await queryRunner.query(`DROP TABLE "system"."mail_queue"`);
		await queryRunner.query(`DROP TYPE "system"."mail_queue_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "grn" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_grn_ref"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_grn_warehouse_status_received_at"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_grn_vendor_id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_grn_warehouse_id"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_grn_supplier_document_number"`,
		);
		await queryRunner.query(`DROP TABLE "grn"`);
		await queryRunner.query(`DROP TYPE "public"."grn_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "invoice" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_client_settlement"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_ref"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_due_sweep"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_overdue_at"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_parent_invoice_id"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_scope"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_invoice_payment_status"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_invoice_status"`);
		await queryRunner.query(`DROP TABLE "invoice"`);
		await queryRunner.query(`DROP TYPE "public"."invoice_scope_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."invoice_payment_status_enum"`,
		);
		await queryRunner.query(`DROP TYPE "public"."invoice_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "order" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_order_ref"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_order_status"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_order_client_id"`);
		await queryRunner.query(`DROP TABLE "order"`);
		await queryRunner.query(
			`DROP TYPE "public"."order_payment_method_enum"`,
		);
		await queryRunner.query(`DROP TYPE "public"."order_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "document_series" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_document_series_key"`,
		);
		await queryRunner.query(`DROP TABLE "document_series"`);
		await queryRunner.query(
			`DROP TYPE "public"."document_series_document_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "discount" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_discount_active"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_discount_reference"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_discount_reason"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_discount_scope"`);
		await queryRunner.query(`DROP TABLE "discount"`);
		await queryRunner.query(`DROP TYPE "public"."discount_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."discount_reason_enum"`);
		await queryRunner.query(`DROP TYPE "public"."discount_scope_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "image_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_image_content_unique_per_lang"`,
		);
		await queryRunner.query(`DROP TABLE "image_content"`);
		await queryRunner.query(`COMMENT ON TABLE "exchange_rate" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_exchange_rate_unique"`,
		);
		await queryRunner.query(`DROP TABLE "exchange_rate"`);
		await queryRunner.query(
			`DROP TYPE "public"."exchange_rate_source_enum"`,
		);
		await queryRunner.query(`DROP INDEX "public"."UQ_complaint_user"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_complaint_open"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_complaint_user_id"`);
		await queryRunner.query(`DROP TABLE "complaint"`);
		await queryRunner.query(`DROP TYPE "public"."complaint_reason_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."complaint_entity_type_enum"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_brand_slug"`);
		await queryRunner.query(`DROP TABLE "brand"`);
		await queryRunner.query(`DROP TYPE "public"."brand_brand_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."brand_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "client" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_company_name_unique"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_client_cui_unique"`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_reg_com_unique"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_client_cnp_unique"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_client_user_id"`);
		await queryRunner.query(`DROP TABLE "client"`);
		await queryRunner.query(`DROP TYPE "public"."client_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."client_client_type_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "client_address" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_address_client_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_client_address_address_id"`,
		);
		await queryRunner.query(`DROP TABLE "client_address"`);
		await queryRunner.query(
			`DROP TYPE "public"."client_address_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "category_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_category_content_category_id_language"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_category_content_slug_language"`,
		);
		await queryRunner.query(`DROP TABLE "category_content"`);
		await queryRunner.query(
			`DROP TYPE "public"."category_content_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "category" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_category_type"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_category_parent_id"`);
		await queryRunner.query(`DROP TABLE "category"`);
		await queryRunner.query(`DROP TYPE "public"."category_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."category_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "brand_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_brand_content_unique_per_lang"`,
		);
		await queryRunner.query(`DROP TABLE "brand_content"`);
		await queryRunner.query(`COMMENT ON TABLE "cash_flow" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cash_flow_created_at"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cash_flow_category_created_at"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cash_flow_method_status"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cash_flow_status_created_at"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cash_flow_parent_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_cash_flow_external_reference"`,
		);
		await queryRunner.query(`DROP TABLE "cash_flow"`);
		await queryRunner.query(`DROP TYPE "public"."cash_flow_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."cash_flow_method_enum"`);
		await queryRunner.query(`DROP TYPE "public"."cash_flow_category_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."cash_flow_category_type_enum"`,
		);
		await queryRunner.query(
			`DROP TYPE "public"."cash_flow_direction_enum"`,
		);
		await queryRunner.query(
			`COMMENT ON TABLE "operational_record" IS NULL`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_operational_record_cash_flow_id"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_operational_record_entity_id"`,
		);
		await queryRunner.query(`DROP TABLE "operational_record"`);
		await queryRunner.query(
			`DROP TYPE "public"."operational_record_operational_record_type_enum"`,
		);
		await queryRunner.query(`COMMENT ON TABLE "carrier" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_carrier_name"`);
		await queryRunner.query(`DROP TABLE "carrier"`);
		await queryRunner.query(`COMMENT ON TABLE "article_content" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_article_content_unique_per_lang"`,
		);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_article_content_slug_lang"`,
		);
		await queryRunner.query(`DROP TABLE "article_content"`);
		await queryRunner.query(`COMMENT ON TABLE "article" IS NULL`);
		await queryRunner.query(
			`DROP INDEX "public"."IDX_article_status_publish_at"`,
		);
		await queryRunner.query(`DROP INDEX "public"."IDX_article_featured"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_article_archive_at"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_article_public_at"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_article_author_id"`);
		await queryRunner.query(`DROP TABLE "article"`);
		await queryRunner.query(
			`DROP TYPE "public"."article_source_mode_enum"`,
		);
		await queryRunner.query(`DROP TYPE "public"."article_visibility_enum"`);
		await queryRunner.query(
			`DROP TYPE "public"."article_featured_status_enum"`,
		);
		await queryRunner.query(`DROP TYPE "public"."article_layout_enum"`);
		await queryRunner.query(`DROP TYPE "public"."article_status_enum"`);
		await queryRunner.query(`COMMENT ON TABLE "address" IS NULL`);
		await queryRunner.query(`DROP INDEX "public"."IDX_address_city_id"`);
		await queryRunner.query(`DROP TABLE "address"`);
	}
}
