import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import type ClientEntity from '@/features/client/client.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

/**
 * Which way the money went.
 *
 * | type | source | sign |
 * |---|---|---|
 * | `payment` | money captured from the client | + |
 * | `refund` | money paid back to the client | - |
 *
 * Only money that actually changed hands: an entry is written when a cash flow completes, and a
 * movement still pending, failed or canceled writes nothing.
 */
export const ClientLedgerEntryTypeEnum = {
	PAYMENT: 'payment',
	REFUND: 'refund',
} as const;

export type ClientLedgerEntryType =
	(typeof ClientLedgerEntryTypeEnum)[keyof typeof ClientLedgerEntryTypeEnum];

const ENTITY_TABLE_NAME = 'client_ledger';

/**
 * Every movement of money between the business and a client: one signed row per completed cash
 * flow filed under the client (a refund under its parent's client).
 *
 * **Append-only.** A row is never updated or deleted; money that went back is its own row, a
 * refund. The sum per client and currency is the net money received from them - positive, the
 * business has taken more than it paid back.
 *
 * Per currency, never summed across: `amount` is in the movement's own currency, and
 * `amount_base` - the same figure at the rate frozen on that row - is what a cross-currency total
 * reads.
 *
 * One row per movement (the unique index on `cash_flow_id`), so the transaction that completes a
 * movement and the reconcile cron that fills whatever was completed without this feature can both
 * run over it without doubling it.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Append-only record of the money moved with each client, per currency',
})
@Index('IDX_client_ledger_client_currency', [
	'client_id',
	'currency',
	'occurred_at',
])
@Index('IDX_client_ledger_cash_flow', ['cash_flow_id'], { unique: true })
// An entry is money that moved; one worth nothing is not one
@Check(`(amount <> 0)`)
export default class ClientLedgerEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column('int', { nullable: false })
	client_id!: number;

	@Column({
		type: 'enum',
		enum: ClientLedgerEntryTypeEnum,
		nullable: false,
	})
	entry_type!: ClientLedgerEntryType;

	@Column('int', { nullable: false })
	cash_flow_id!: number;

	@Column('char', {
		length: 3,
		nullable: false,
		comment: 'Currency of the movement',
	})
	currency!: string;

	/*
	 * Signed, unlike every other money column in the codebase: this is the one table summed across
	 * movements of opposite direction, and storing the sign is what keeps that a plain SUM. Gross,
	 * in two decimals - `cash_flow.amount` is net with four, so a movement's sub-cent change is
	 * rounded away here.
	 */
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		comment:
			'Positive: money received from the client; negative: money paid back',
		transformer: numericTransformer,
	})
	amount!: number;

	@Column('decimal', {
		precision: 10,
		scale: 6,
		nullable: false,
		default: 1,
		comment:
			'Rate to the deployment base currency, frozen from the movement',
		transformer: numericTransformer,
	})
	exchange_rate!: number;

	@Column('decimal', {
		precision: 14,
		scale: 2,
		nullable: false,
		comment: 'amount * exchange_rate, in the deployment base currency',
		transformer: numericTransformer,
	})
	amount_base!: number;

	@Column({
		type: 'timestamp',
		nullable: false,
		comment: 'When the money moved',
	})
	occurred_at!: Date;

	// RELATIONS
	// RESTRICT on both: an entry is the record that money moved, and neither the client nor the
	// movement may disappear from under it. Both are soft-deleted in practice, which leaves the key
	// alone
	@ManyToOne('ClientEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'client_id' })
	client!: ClientEntity;

	@ManyToOne('CashFlowEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'cash_flow_id' })
	cash_flow!: CashFlowEntity;
}
