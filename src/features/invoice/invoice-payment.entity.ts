import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import { toGrossAmount } from '@/features/cash-flow/cash-flow.entity';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

const ENTITY_TABLE_NAME = 'invoice_payment';

/**
 * The most a movement can ever settle: its gross worth, in its own currency.
 *
 * Allocations against one movement may span several invoices, so a caller checks a new allocation
 * against this minus what the movement has already been allocated. It takes the two columns rather
 * than the entity so it cannot be handed a row loaded without them.
 *
 * **This is the only correct ceiling.** `cash_flow.amount` is net and scaled by four decimals;
 * using it raw over-states the ceiling by the VAT rate on a 19% movement by a factor of 10,000 in
 * the other direction. `cash_flow.gross_amount` is a `VirtualColumn` and is absent from any row
 * loaded through an explicit `select([...])`, where it reads `undefined` and compares as `NaN`, so
 * every comparison against it silently passes.
 *
 * The movement's `currency` must equal the invoice's before this figure means anything - the two
 * are separate columns with no constraint tying them, and converting between them would need a
 * rate neither row carries for the other's date.
 */
export const maxAllocatableAmount = (
	amount: number,
	vatRate: number,
): number => {
	return toGrossAmount(amount, vatRate);
};

/**
 * How much of a cash movement settles which invoice.
 *
 * An allocation table rather than an `invoice_id` on `cash_flow`, because settlement is
 * many-to-many in practice: a deposit and a balance are two movements against one invoice, a
 * single bank transfer from a company client clears several, and a refund is a movement allocated
 * against the reversal that authorized it. A single column can express none of those.
 *
 * It also keeps `cash_flow` free of document coupling - it has no `order_id` or `invoice_id` and
 * reaches its counterparties through `operational_record` - so the ledger stays a ledger.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Settles a cash movement against an invoice, in part or in full',
})
// RESTRICT on both sides, so the unique index cannot be worked around by deleting one end
@Index('IDX_invoice_payment_pair', ['invoice_id', 'cash_flow_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
@Check(`(amount > 0)`)
export default class InvoicePaymentEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_invoice_payment_invoice_id')
	invoice_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_invoice_payment_cash_flow_id')
	cash_flow_id!: number;

	/**
	 * How much of the movement this allocation claims, **gross**, in the invoice's currency and
	 * scale.
	 *
	 * This is the one place the two money formats in this codebase meet, and they differ in two
	 * ways at once:
	 *
	 * - *Scale.* Documents carry `numeric(12,2)` (`order_line.price`, `shipping.price`,
	 *   `invoice.total_gross`) while `cash_flow.amount` is an integer scaled by
	 *   `10 ** AMOUNT_DECIMALS`. The document side wins here, because what an allocation has to add
	 *   up against is `invoice.total_gross`. A movement can therefore hold sub-cent change no
	 *   allocation can claim, which is what `PAYMENT_SETTLED_TOLERANCE` exists for.
	 * - *VAT.* `cash_flow.amount` is **net** - gross only exists through `GROSS_AMOUNT_EXPRESSION`,
	 *   or `toGrossAmount()` for an entity in hand. This column is gross, because `total_gross` is
	 *   what a buyer owes. Comparing an allocation against `cash_flow.amount` directly is wrong by
	 *   the VAT rate and is the mistake `maxAllocatableAmount()` below exists to prevent.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment: 'Amount settled, in the invoice currency',
		transformer: numericTransformer,
	})
	amount!: number;

	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	// RESTRICT: an allocation is the evidence that an invoice was settled, so neither the document
	// nor the movement may be removed while it stands
	@ManyToOne('InvoiceEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'invoice_id' })
	invoice!: InvoiceEntity;

	@ManyToOne('CashFlowEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'cash_flow_id' })
	cash_flow!: CashFlowEntity;
}
