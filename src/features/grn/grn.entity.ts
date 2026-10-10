import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import type GrnItemEntity from '@/features/grn/grn-item.entity';
import type VendorEntity from '@/features/vendor/vendor.entity';
import type WarehouseEntity from '@/features/warehouse/warehouse.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { StatusTransitions } from '@/shared/types/common.type';

export const GrnStatusEnum = {
	DRAFT: 'draft', // Being entered; nothing has moved
	CONFIRMED: 'confirmed', // Stock is in, lots are open, cost has been averaged
	CANCELED: 'canceled', // Withdrawn; if it had been confirmed, reversing movements were posted
} as const;

export type GrnStatus = (typeof GrnStatusEnum)[keyof typeof GrnStatusEnum];

/**
 * Allowed status transition configuration.
 *
 * A confirmed receipt can still be canceled, but never returns to draft: the moment it confirmed
 * it wrote movements, opened lots and moved the weighted average cost, and a draft is defined by
 * having done none of that. Canceling posts the reversals instead.
 */
export const STATUS_TRANSITIONS: StatusTransitions<GrnStatus> = {
	[GrnStatusEnum.DRAFT]: [GrnStatusEnum.CONFIRMED, GrnStatusEnum.CANCELED],
	[GrnStatusEnum.CONFIRMED]: [GrnStatusEnum.CANCELED],
	[GrnStatusEnum.CANCELED]: [
		// Allow nothing
	],
};

const ENTITY_TABLE_NAME = 'grn';

/**
 * Goods received note - the document that brings stock into a warehouse.
 *
 * **Everything inbound is a GRN**, including the stock already owned on the day the system starts.
 * There is no separate opening-balance concept, and that is deliberate: `grn_item.qty_remaining` is
 * the authoritative on-hand figure, so every unit has to belong to a lot with a cost.
 *
 * **Stock moves only on confirmation.** A draft can be edited freely because it has changed
 * nothing. Confirming writes `warehouse_movement` rows, opens the lots and recomputes
 * `product_variant.cost_price`; canceling a confirmed receipt posts reversing movements rather
 * than deleting anything.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Goods received notes; the only way stock enters a warehouse, and the source of every FIFO lot',
})
@Index('IDX_grn_ref', ['ref_code', 'ref_number'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
// FIFO resolves open lots for a variant, then needs the confirmed receipts they belong to in
// receipt order - this is the header side of that join
@Index('IDX_grn_warehouse_status_received_at', [
	'warehouse_id',
	'status',
	'received_at',
])
export default class GrnEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('varchar', {
		length: 10,
		nullable: false,
		comment: 'Series code allocated from document_series, e.g. NIR',
	})
	ref_code!: string;

	@Column('int', {
		nullable: false,
		comment: 'Sequential number within the series',
	})
	ref_number!: number;

	@Column('varchar', {
		nullable: true,
		comment: "The supplier's own delivery note or invoice number",
	})
	@Index('IDX_grn_supplier_document_number')
	supplier_document_number!: string | null;

	@Column({
		type: 'enum',
		enum: GrnStatusEnum,
		default: GrnStatusEnum.DRAFT,
		nullable: false,
	})
	status!: GrnStatus;

	@Column({
		type: 'timestamp',
		nullable: false,
		comment: 'When the goods physically arrived; drives FIFO order',
	})
	received_at!: Date;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'When the stock actually moved',
	})
	confirmed_at!: Date | null;

	@Column('char', {
		length: 3,
		nullable: false,
		default: 'RON',
		comment: 'Currency the supplier invoiced in',
	})
	currency!: string;

	// Frozen at the rate of the receiving day. Costs are converted into base currency once, here,
	// and never again - converting at read time would make last month's margin move with today's
	// rate
	@Column('decimal', {
		precision: 10,
		scale: 6,
		nullable: false,
		default: 1,
		comment: 'Rate to the base currency (1 = same currency)',
		transformer: numericTransformer,
	})
	exchange_rate!: number;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@Column('int', { nullable: false })
	@Index('IDX_grn_warehouse_id')
	warehouse_id!: number;

	@Column('int', { nullable: false })
	@Index('IDX_grn_vendor_id')
	vendor_id!: number;

	@ManyToOne('WarehouseEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'warehouse_id' })
	warehouse!: WarehouseEntity;

	@ManyToOne('VendorEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'vendor_id' })
	vendor!: VendorEntity;

	@OneToMany('GrnItemEntity', (item: GrnItemEntity) => item.grn)
	items?: GrnItemEntity[];
}
