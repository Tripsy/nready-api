import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

/**
 * What a document was raised from. One link per kind, so a new billable feature adds a value here
 * rather than a column - and a key - on `invoice`.
 *
 * - `order` - the order whose goods it bills, or whose movement it bills (`shipping` documents
 *   name both).
 * - `shipping` - the one movement of goods a `shipping` document bills.
 * - `subscription` - the subscription a `subscription` document bills.
 *
 * The client is not a source: every document has one, so it stays `invoice.client_id`.
 */
export const InvoiceSourceTypeEnum = {
	ORDER: 'order',
	SHIPPING: 'shipping',
	SUBSCRIPTION: 'subscription',
} as const;

export type InvoiceSourceType =
	(typeof InvoiceSourceTypeEnum)[keyof typeof InvoiceSourceTypeEnum];

const ENTITY_TABLE_NAME = 'invoice_source';

/**
 * A document's links to the rows it was raised from, the way `operational_record` files a cash
 * movement under its counterparties: `(invoice, type, id)`, no key to the target.
 *
 * No key on purpose. A feature that bills through invoices - `subscription` today, more later -
 * depends on `invoice`, so a key running the other way would close a cycle and make every such
 * feature a column and a migration on `invoice`. The id is resolved by whichever code reads that
 * type; the invoice carries its own frozen figures and parties, so a source row going away loses
 * nothing the document needs.
 *
 * Written once, when the document is raised - a reversal copies its original's - and never
 * changed after.
 *
 * TODO: with no key on `source_id`, nothing stops an invoiced order from being hard-deleted, which
 * the `RESTRICT` on the former `invoice.order_id` did. Orders are soft-deleted in practice; if a
 * hard delete path appears, `order` has to refuse it while a live `invoice_source` names the order
 * (through a registry, since `order` cannot import `invoice`).
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'What each invoice was raised from - order, shipping, subscription',
})
@Index('IDX_invoice_source_invoice', ['invoice_id', 'source_type'], {
	unique: true,
})
// The reverse lookup every "documents of order X" question runs on
@Index('IDX_invoice_source_target', ['source_type', 'source_id'])
export default class InvoiceSourceEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column('int', { nullable: false })
	invoice_id!: number;

	@Column({
		type: 'enum',
		enum: InvoiceSourceTypeEnum,
		nullable: false,
	})
	source_type!: InvoiceSourceType;

	@Column('int', { nullable: false })
	source_id!: number;

	// RELATIONS
	// CASCADE: a link means nothing without its document
	@ManyToOne('InvoiceEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'invoice_id' })
	invoice!: InvoiceEntity;
}
