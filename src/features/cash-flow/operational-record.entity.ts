import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	type CashFlowCategory,
	CashFlowCategoryEnum,
} from '@/features/cash-flow/cash-flow-category.enum';
import type ClientEntity from '@/features/client/client.entity';
import type VendorEntity from '@/features/vendor/vendor.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

/**
 * What a movement is recorded against. The first two name a counterparty - who the money came
 * from or went to - and `order` names the document it was raised for.
 *
 * `order` is what lets a payment exist before there is anything to allocate it to: an online
 * checkout asks for the money up front, and the invoice is only raised once that money lands, so
 * at request time `invoice_payment` has no row to point at. It carries no amount, unlike
 * `invoice_payment` - the movement settles the one order in full or it settles nothing, and a
 * payment split across several orders is recorded on the invoices instead.
 *
 * Nothing here imports `order`, and `cash_flow` deliberately does not hydrate the row the way it
 * hydrates a client or a vendor: the value is an id in a table this feature knows nothing about,
 * and reaching for it would make the ledger depend on the shop.
 */
export const OperationalRecordTypeEnum = {
	CLIENT: 'client',
	VENDOR: 'vendor',
	ORDER: 'order',
} as const;

export type OperationalRecordType =
	(typeof OperationalRecordTypeEnum)[keyof typeof OperationalRecordTypeEnum];

export type CashFlowCategoryOperationalRecordOptionsType = {
	required?: OperationalRecordType[];
	optional?: OperationalRecordType[];
};

type CashFlowCategoryOperationalRecordType = Partial<
	Record<CashFlowCategory, CashFlowCategoryOperationalRecordOptionsType>
>;

const CashFlowCategoryOperationalRecord: CashFlowCategoryOperationalRecordType =
	{
		// `order` is optional rather than required: a sale can stand on its own - a deposit, a
		// correction typed up in the back office - and only a checkout has a document to name at
		// the time the money is asked for. An operator may attach one later, which is what lets a
		// movement banked before anybody matched it to an order be invoiced from that order
		[CashFlowCategoryEnum.SALE]: {
			required: [OperationalRecordTypeEnum.CLIENT],
			optional: [OperationalRecordTypeEnum.ORDER],
		},
		[CashFlowCategoryEnum.VENDOR]: {
			required: [OperationalRecordTypeEnum.VENDOR],
		},
		[CashFlowCategoryEnum.INSURANCE]: {
			required: [OperationalRecordTypeEnum.VENDOR],
		},
		[CashFlowCategoryEnum.TAXES]: {
			required: [OperationalRecordTypeEnum.VENDOR],
		},
	};

export const getOperationalRecordOptions = (
	category: CashFlowCategory,
): CashFlowCategoryOperationalRecordOptionsType | null => {
	return CashFlowCategoryOperationalRecord[category] ?? null;
};

const ENTITY_TABLE_NAME = 'operational_record';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Store operational records linked with cash flow operations.',
})
@Index(
	'IDX_operational_record_cash_flow_id',
	['cash_flow_id', 'operational_record_type'],
	{ unique: true, where: 'deleted_at IS NULL' },
)
@Index('IDX_operational_record_entity_id', [
	'entity_id',
	'operational_record_type',
])
export default class OperationalRecordEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int')
	cash_flow_id!: number;

	@Column({
		type: 'enum',
		enum: OperationalRecordTypeEnum,
		nullable: false,
	})
	operational_record_type!: OperationalRecordType;

	@Column('int', { nullable: false })
	entity_id!: number;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('CashFlowEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'cash_flow_id' })
	cash_flow!: CashFlowEntity;
}

export type OperationalRecordWithRelations = OperationalRecordEntity & {
	[OperationalRecordTypeEnum.CLIENT]?: ClientEntity | null;
	[OperationalRecordTypeEnum.VENDOR]?: VendorEntity | null;
};
