import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { AddressSnapshotRequiredCountry } from '@/features/address/address.entity';
import type ClientEntity from '@/features/client/client.entity';
import type {
	ClientTypeEnum,
	ContactSnapshot,
	FinancialSnapshot,
} from '@/features/client/client.entity';
import {
	type DocumentType,
	DocumentTypeEnum,
} from '@/features/document-series/document-series.entity';
import { OrderStatusEnum } from '@/features/order/order.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { StatusTransitions } from '@/shared/types/common.type';

export const InvoiceStatusEnum = {
	DRAFT: 'draft', // Being assembled, holds no number yet, still editable
	ISSUED: 'issued', // Number allocated, document frozen
	CANCELED: 'canceled', // Invalidated before it was ever settled
} as const;

export type InvoiceStatus =
	(typeof InvoiceStatusEnum)[keyof typeof InvoiceStatusEnum];

/**
 * A document moves one way only. `issued` is where it freezes: the number has been spent, the
 * buyer holds a copy, and the only move left is to invalidate the whole document.
 *
 * Nothing leads back to `draft` - a number cannot be handed back to the series - and `canceled`
 * is terminal for the same reason. An issued document is taken back by a reversal - which
 * refunds what was paid on it - not by a way back up this list.
 */
export const STATUS_TRANSITIONS: StatusTransitions<InvoiceStatus> = {
	[InvoiceStatusEnum.DRAFT]: [
		InvoiceStatusEnum.ISSUED,
		InvoiceStatusEnum.CANCELED,
	],

	// An issued document is the record of what was charged, and it is taken back only by a
	// reversal - which refunds what was paid, books the ledger and carries a number of its own.
	// Canceling it would do none of that.
	[InvoiceStatusEnum.ISSUED]: [
		// Allow nothing
	],

	[InvoiceStatusEnum.CANCELED]: [
		// Allow nothing
	],
};

/**
 * The statuses whose figures may still be rewritten - the lines, the totals, the dates. Only a
 * draft: an issued document is the record of what was charged, and the buyer has a copy of it.
 */
export const MUTABLE_STATUSES = [InvoiceStatusEnum.DRAFT];

/**
 * How far the invoice has been settled - the sum of its `invoice_payment` allocations measured
 * against `total_gross`, stored so a list can filter on it.
 */
export const InvoicePaymentStatusEnum = {
	UNPAID: 'unpaid',
	PARTIAL: 'partial', // Allocated, but short of the total
	PAID: 'paid',
} as const;

export type InvoicePaymentStatus =
	(typeof InvoicePaymentStatusEnum)[keyof typeof InvoicePaymentStatusEnum];

/**
 * How much of a document may stay unallocated and still count as settled: half a cent, below the
 * two decimals the column stores.
 *
 * `cash_flow.amount` carries four decimals and an allocation carries two, so a movement can hold
 * sub-cent change no allocation can ever claim - see the note on `invoice_payment.amount`. Without
 * a tolerance an invoice settled in full by such a movement would sit at `partial` forever and
 * dunning would chase a buyer who owes nothing.
 */
export const PAYMENT_SETTLED_TOLERANCE = 0.005;

/**
 * Where a document stands once its allocations are summed. Both figures are **gross** and in the
 * invoice's own currency, which is what `invoice_payment.amount` stores.
 *
 * Over-allocation reads as `paid` rather than as a state of its own: a buyer who sent too much is
 * owed a refund, and that is a reversal plus its own movement, not a status on this row.
 */
export const resolvePaymentStatus = (
	totalGross: number,
	allocatedGross: number,
): InvoicePaymentStatus => {
	if (allocatedGross >= totalGross - PAYMENT_SETTLED_TOLERANCE) {
		return InvoicePaymentStatusEnum.PAID;
	}

	return allocatedGross > 0
		? InvoicePaymentStatusEnum.PARTIAL
		: InvoicePaymentStatusEnum.UNPAID;
};

/**
 * What a document bills, which decides how it reads and which lines it may carry.
 *
 * - `order` - the goods on an order, as `product` lines. An order may carry several: a partial
 *   shipment invoiced as it goes, physical goods and services billed apart, a corrected document
 *   raised after a reversal.
 * - `shipping` - what a movement of goods cost, as `shipping` lines. The fee lives on the
 *   `shipping` row, not in the order total (`OrderService.computeTotals` leaves it out), and an
 *   order that travels as two parcels is billed for two.
 * - `subscription` - a period of a subscription, as `adjustment` lines. Raised by hand for now; a
 *   billing cycle is a later feature.
 * - `custom` - a document built by hand for a client, with no order behind it: a one-off service,
 *   a charge agreed off-system, money banked with nothing in the catalogue to itemize. Its lines
 *   are `adjustment` lines, and its buyer is frozen from the client when it is raised.
 *
 * Every scope may add `adjustment` lines - rounding, a manual correction.
 *
 * Whether a document takes money back is not a scope: a reversal carries `is_reversal`
 * and the scope of the document it reverses, so a reversed shipping document is still read and
 * rendered as a shipping document.
 */
export const InvoiceScopeEnum = {
	ORDER: 'order',
	SHIPPING: 'shipping',
	SUBSCRIPTION: 'subscription',
	CUSTOM: 'custom',
} as const;

export type InvoiceScope =
	(typeof InvoiceScopeEnum)[keyof typeof InvoiceScopeEnum];

/**
 * The series every invoice spends its number from, reversals included: they are all invoices to
 * the tax authority, which expects one continuous numbering, and a storno is numbered as the next
 * invoice rather than out of a series of its own.
 */
export const INVOICE_DOCUMENT_TYPE: DocumentType = DocumentTypeEnum.INVOICE;

/**
 * The order states a document may be raised from - everything but `canceled`, which was never
 * charged at all.
 *
 * `pending` is included because the shop bills up front: a checkout raises the order's documents
 * at once and the order is confirmed once they are paid. The lines of an order with a live `order`
 * document are locked from that point (`OrderService.updateData` asks `isOrderInvoiced`), so a
 * document cannot be left describing lines that were rewritten under it.
 */
export const INVOICEABLE_ORDER_STATUSES = [
	OrderStatusEnum.PENDING,
	OrderStatusEnum.CONFIRMED,
	OrderStatusEnum.COMPLETED,
];

/**
 * Everything a frozen party carries on a document apart from what identifies it: the shared
 * address, contact and banking shapes, with a country the invoice cannot go out without. Only the
 * identity fields differ between a person, a company and the seller.
 */
type PartySnapshot = AddressSnapshotRequiredCountry &
	ContactSnapshot &
	FinancialSnapshot;

export type BillingDetailsPerson = PartySnapshot & {
	type: typeof ClientTypeEnum.PERSON;

	// Person
	person_name: string;
	person_identification_number?: string | null;
};

export type BillingDetailsCompany = PartySnapshot & {
	type: typeof ClientTypeEnum.COMPANY;

	// Company
	company_name: string;
	company_cui?: string | null;
	company_reg_com?: string | null;
};

export type BillingDetails = BillingDetailsPerson | BillingDetailsCompany;

/**
 * Who issued the document. Snapshot for the same reason `billing_details` is: the company moves
 * office, changes bank or re-registers, and an invoice already handed to a buyer must keep showing
 * what it showed on the day.
 */
export type SellerDetails = PartySnapshot & {
	company_name: string;
	company_cui?: string | null;
	company_reg_com?: string | null;
	/**
	 * The VAT registration code; `null` states the seller is not registered for VAT. Absent on a
	 * snapshot frozen before the field existed, which therefore states nothing either way - a
	 * printed copy must not claim a status the document never recorded.
	 */
	company_vat_number?: string | null;
};

/**
 * What a document was raised from, read off its `invoice_source` rows - see
 * `invoice-source.entity.ts`. Not columns of `invoice`, so a loaded row does not carry them: only
 * `InvoiceService.withSources` (and the finders built on it) hand out an `InvoiceWithSources`, which
 * is what every caller that needs one asks for by type.
 *
 * Each is null when the document has no source of that kind - a `custom` document names none.
 */
export type InvoiceSources = {
	order_id: number | null;
	shipping_id: number | null;
	subscription_id: number | null;
};

export type InvoiceWithSources = InvoiceEntity & InvoiceSources;

const ENTITY_TABLE_NAME = 'invoice';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores invoices',
})
// A reversal is meaningless without the document it takes back, and only a reversal names one
@Check(`(is_reversal = (parent_invoice_id IS NOT NULL))`)
/*
 * What a client's payment is allocated against: their live, unsettled originals, oldest first. A
 * reversal is settled by a refund, never by the client's incoming money, so it stays out.
 */
@Index(
	'IDX_invoice_client_settlement',
	['client_id', 'status', 'payment_status'],
	{ where: 'is_reversal = false' },
)
/*
 * A number is spent the moment it is handed out - `document_series` counts continuously and has no
 * release path - so the pair is allocated on the transition to `issued`, not when the row is
 * created. The index therefore has to tolerate however many drafts are open at once, which is what
 * the `ref_number IS NOT NULL` arm is for.
 */
@Index('IDX_invoice_ref', ['ref_code', 'ref_number'], {
	unique: true,
	where: 'deleted_at IS NULL AND ref_number IS NOT NULL',
})
/*
 * What the overdue sweep reads: issued documents past their due date that have not been stamped
 * yet. The predicate is the sweep's own end state, so the index holds only the rows still to be
 * looked at and shrinks as they are stamped - the whole table would otherwise be scanned nightly
 * for the handful that just went late.
 */
@Index('IDX_invoice_due_sweep', ['due_at'], {
	where: "deleted_at IS NULL AND overdue_at IS NULL AND due_at IS NOT NULL AND status = 'issued'",
})
@Check(`(total_net >= 0)`)
@Check(`(total_discount_reduction >= 0)`)
@Check(`(total_vat >= 0)`)
@Check(`(total_gross >= 0)`)
export default class InvoiceEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	/**
	 * Who is billed. Stored rather than read through the order because a document need not have
	 * one - a bare revenue movement, a subscription period - and because the client ledger and
	 * the allocation of a client's payments both read documents by client, on every capture.
	 *
	 * RESTRICT: a client with documents issued to them is a party to the books.
	 */
	@Column('int', { nullable: false })
	client_id!: number;

	/**
	 * Not unique: an order may carry several documents of each scope - a partly shipped order
	 * invoiced per parcel, a reversal and the corrected document raised after it.
	 */
	@Column('varchar', {
		length: 10,
		nullable: true,
		comment: 'Series code allocated from document_series, e.g. INV',
	})
	ref_code!: string | null;

	@Column('int', {
		nullable: true,
		comment: 'Sequential invoice number within the series',
	})
	ref_number!: number | null;

	@Column({
		type: 'enum',
		enum: InvoiceStatusEnum,
		default: InvoiceStatusEnum.DRAFT,
		nullable: false,
	})
	@Index('IDX_invoice_status')
	status!: InvoiceStatus;

	@Column({
		type: 'enum',
		enum: InvoicePaymentStatusEnum,
		default: InvoicePaymentStatusEnum.UNPAID,
		nullable: false,
	})
	@Index('IDX_invoice_payment_status')
	payment_status!: InvoicePaymentStatus;

	@Column({
		type: 'enum',
		enum: InvoiceScopeEnum,
		default: InvoiceScopeEnum.ORDER,
		nullable: false,
	})
	@Index('IDX_invoice_scope')
	scope!: InvoiceScope;

	/**
	 * A reversal: this document takes back part or all of
	 * `parent_invoice_id`, and carries that document's scope.
	 *
	 * Its figures stay positive like every other document's - the flag carries the sign, the way
	 * `cash_flow.direction` does - and it is numbered from the same series as the original.
	 */
	@Column('boolean', { nullable: false, default: false })
	is_reversal!: boolean;

	/**
	 * The document this one reverses. Set on a reversal, NULL on everything else.
	 *
	 * RESTRICT: a reversal only means anything next to the invoice it corrects, so that invoice
	 * has to stay reachable for as long as the reversal does.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_invoice_parent_invoice_id', {
		where: 'parent_invoice_id IS NOT NULL',
	})
	parent_invoice_id!: number | null;

	// COST RELATED
	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
		comment: 'Currency the document is issued in',
	})
	currency!: string;

	@Column('decimal', {
		precision: 10,
		scale: 6,
		nullable: false,
		default: 1,
		comment:
			'Exchange rate to the deployment base currency (default 1 = same currency)',
		transformer: numericTransformer,
	})
	exchange_rate!: number;

	/*
	 * Totals are stored, not summed from the lines on read, and this is the point of the table.
	 * An invoice is the frozen record of what was charged: recomputing it would let a later change
	 * to a pricing helper - or to `order_line`, which is replaced wholesale while the order is
	 * still `pending` - move a figure a buyer has already been handed. The lines carry the same
	 * arithmetic for the same reason.
	 *
	 * `numeric(12,2)` like `order_line.price` and `shipping.price`, not the scaled integer
	 * `cash_flow.amount` uses; `invoice_payment.amount` is where the two units meet.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Sum of the line nets, after discount, excluding VAT',
		transformer: numericTransformer,
	})
	total_net!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'Money off across all lines, excluding VAT',
		transformer: numericTransformer,
	})
	total_discount_reduction!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		transformer: numericTransformer,
	})
	total_vat!: number;

	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		default: 0,
		comment: 'What the buyer owes: total_net + total_vat',
		transformer: numericTransformer,
	})
	total_gross!: number;

	// DATES
	// Stamped on the transition to `issued`, alongside the number
	@Column({ type: 'timestamp', nullable: true })
	issued_at!: Date | null;

	@Column({ type: 'timestamp', nullable: true })
	due_at!: Date | null;

	/**
	 * When the invoice first went past `due_at` unsettled, stamped by the cron that sweeps for it.
	 * NULL means it has never been late.
	 *
	 * **Not cleared when the invoice is finally paid**, so it keeps recording that this client paid
	 * late - which is the reason to store the fact at all rather than derive it. "Late right now"
	 * is therefore `overdue_at IS NOT NULL AND payment_status <> 'paid'`; `overdue_at` alone reads
	 * "was late at some point". A dunning run wants the first, a credit assessment the second.
	 */
	@Column({ type: 'timestamp', nullable: true })
	@Index('IDX_invoice_overdue_at', { where: 'overdue_at IS NOT NULL' })
	overdue_at!: Date | null;

	@Column({ type: 'timestamp', nullable: true })
	paid_at!: Date | null;

	// OTHER
	@Column('jsonb', {
		nullable: true,
		comment:
			'Snapshot of billing info at the moment of issuing the invoice',
	})
	billing_details!: BillingDetails | null;

	@Column('jsonb', {
		nullable: true,
		comment: 'Snapshot of the issuer at the moment of issuing the invoice',
	})
	seller_details!: SellerDetails | null;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('ClientEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'client_id' })
	client!: ClientEntity;

	@ManyToOne('InvoiceEntity', {
		onDelete: 'RESTRICT',
		nullable: true,
	})
	@JoinColumn({ name: 'parent_invoice_id' })
	parent_invoice?: InvoiceEntity | null;
}
