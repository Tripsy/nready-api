import {
	Check,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	VirtualColumn,
} from 'typeorm';
import {
	type CashFlowCategory,
	CashFlowCategoryEnum,
} from '@/features/cash-flow/cash-flow-category.enum';
import OperationalRecordEntity from '@/features/cash-flow/operational-record.entity';
import { arrayHasValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, roundMoney } from '@/helpers/shop.helper';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';
import type { StatusTransitions } from '@/shared/types/common.type';

export const CashFlowDirectionEnum = {
	IN: 'in', // money received relative to company
	OUT: 'out', // money sent relative to company
} as const;

export type CashFlowDirection =
	(typeof CashFlowDirectionEnum)[keyof typeof CashFlowDirectionEnum];

export const CashFlowCategoryTypeEnum = {
	REVENUE: 'revenue',
	EXPENSE: 'expense',
	CORRECTION: 'correction',
} as const;

export type CashFlowCategoryType =
	(typeof CashFlowCategoryTypeEnum)[keyof typeof CashFlowCategoryTypeEnum];

export const getExpectedCategoryType = (
	category: CashFlowCategory,
): CashFlowCategoryType => {
	const revenueCategories = [CashFlowCategoryEnum.CUSTOMER];
	const expenseCategories = [
		CashFlowCategoryEnum.VENDOR,
		CashFlowCategoryEnum.INSURANCE,
		CashFlowCategoryEnum.TAXES,
	];
	const correctionCategories = [CashFlowCategoryEnum.REFUND];

	if (arrayHasValue(category, revenueCategories)) {
		return CashFlowCategoryTypeEnum.REVENUE;
	}

	if (arrayHasValue(category, expenseCategories)) {
		return CashFlowCategoryTypeEnum.EXPENSE;
	}

	if (arrayHasValue(category, correctionCategories)) {
		return CashFlowCategoryTypeEnum.CORRECTION;
	}

	throw new Error(`Unknown category: ${category}`);
};

export const getExpectedDirection = (
	categoryType: CashFlowCategoryType,
): CashFlowDirection | null => {
	switch (categoryType) {
		case CashFlowCategoryTypeEnum.REVENUE:
			return CashFlowDirectionEnum.IN;
		case CashFlowCategoryTypeEnum.EXPENSE:
			return CashFlowDirectionEnum.OUT;
		case CashFlowCategoryTypeEnum.CORRECTION:
			// Correction can be both, so no specific direction
			return null;
	}
};

export const CashFlowStatusEnum = {
	PENDING: 'pending', // Created, waiting for gateway or user redirect
	AUTHORIZED: 'authorized', // CashFlow authorized but not captured
	COMPLETED: 'completed', // Money captured
	FAILED: 'failed',
	CANCELED: 'canceled', // User canceled before completion
	EXPIRED: 'expired', // Authorization expired
	REQUIRES_ACTION: 'requires_action', // 3D Secure, etc.
} as const;

export type CashFlowStatus =
	(typeof CashFlowStatusEnum)[keyof typeof CashFlowStatusEnum];

// Only entries with specified statuses are available for update
export const MUTABLE_STATUSES = [
	CashFlowStatusEnum.PENDING,
	CashFlowStatusEnum.AUTHORIZED,
	CashFlowStatusEnum.REQUIRES_ACTION,
];

// Only entries with specified statuses are eligible for refund
export const REFUNDABLE_STATUSES = [CashFlowStatusEnum.COMPLETED];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<CashFlowStatus> = {
	[CashFlowStatusEnum.PENDING]: [
		CashFlowStatusEnum.AUTHORIZED,
		CashFlowStatusEnum.COMPLETED,
		CashFlowStatusEnum.FAILED,
		CashFlowStatusEnum.CANCELED,
		CashFlowStatusEnum.EXPIRED,
		CashFlowStatusEnum.REQUIRES_ACTION,
	],

	[CashFlowStatusEnum.AUTHORIZED]: [
		CashFlowStatusEnum.COMPLETED,
		CashFlowStatusEnum.CANCELED,
		CashFlowStatusEnum.EXPIRED,
	],

	[CashFlowStatusEnum.REQUIRES_ACTION]: [
		CashFlowStatusEnum.AUTHORIZED,
		CashFlowStatusEnum.FAILED,
		CashFlowStatusEnum.CANCELED,
	],

	[CashFlowStatusEnum.COMPLETED]: [
		// Allow nothing
	],

	[CashFlowStatusEnum.FAILED]: [],
	[CashFlowStatusEnum.CANCELED]: [],
	[CashFlowStatusEnum.EXPIRED]: [],
};

export const CashFlowMethodEnum = {
	// Card methods
	CREDIT_CARD: 'credit_card',
	DEBIT_CARD: 'debit_card',

	// Digital wallets
	PAYPAL: 'paypal',

	// Traditional
	CASH: 'cash',
	BANK_TRANSFER: 'bank_transfer',
	CHECK: 'check',

	// // Other
	CRYPTO: 'crypto',
	GIFT_CARD: 'gift_card',
} as const;

export type CashFlowMethod =
	(typeof CashFlowMethodEnum)[keyof typeof CashFlowMethodEnum];

// Define number of decimals allowed for amount value
export const AMOUNT_DECIMALS = 4;

/**
 * Hard-rules:
 * 	- Only MUTABLE_STATUSES can be updated (therefore REFUND, PARTIALLY_UPDATED cannot be updated)
 * 	- Only REFUNDABLE_STATUSES are available for REFUND
 * 	- `restore` functionality should not be implemented
 * 	- On `delete` if entry has refunds the operation is blocked unless `force` argument is present and then refunds are also deleted
 * 	- Status update is controlled via STATUS_TRANSITIONS
 * 	- `amount` is stored as positive number without decimals
 * 	- `gross_amount` is calculated based on `amount` and `vat_rate` (depends on AMOUNT_DECIMALS)
 * 	- `net_amount` is calculated based on `amount` and `vat_rate` (depends on AMOUNT_DECIMALS)
 */
const ENTITY_TABLE_NAME = 'cash_flow';

export const NET_AMOUNT_EXPRESSION = (alias: string) => `
	CASE 
		WHEN ${alias}.direction = '${CashFlowDirectionEnum.IN}' 
		THEN CAST(${alias}.amount AS FLOAT) / ${10 ** AMOUNT_DECIMALS}
		ELSE -(CAST(${alias}.amount AS FLOAT) / ${10 ** AMOUNT_DECIMALS})
	END
`;

export const GROSS_AMOUNT_EXPRESSION = (alias: string) => `
    CASE 
        WHEN ${alias}.direction = '${CashFlowDirectionEnum.IN}' 
        THEN (CAST(${alias}.amount AS FLOAT) / ${10 ** AMOUNT_DECIMALS}) * (1 + CAST(${alias}.vat_rate AS FLOAT) / 100)
        ELSE -((CAST(${alias}.amount AS FLOAT) / ${10 ** AMOUNT_DECIMALS}) * (1 + CAST(${alias}.vat_rate AS FLOAT) / 100))
    END
`;

/**
 * Gross amount converted to the deployment's base currency. Rows carry their own `currency` with
 * the `exchange_rate` captured at the time of the entry, so a SUM over mixed-currency rows is
 * only meaningful once each row is scaled by its own rate.
 */
export const GROSS_AMOUNT_BASE_CURRENCY_EXPRESSION = (alias: string) => `
	(${GROSS_AMOUNT_EXPRESSION(alias)}) * CAST(${alias}.exchange_rate AS FLOAT)
`;

/**
 * What a movement is worth gross, in its own currency, as a money figure - the TypeScript twin of
 * `GROSS_AMOUNT_EXPRESSION`, rounded to the two decimals every document column stores.
 *
 * Needed beside the SQL because the `gross_amount` virtual column is only populated when the query
 * asks for it, and `RepositoryAbstract.select([...])` routinely does not. Reading
 * `entry.gross_amount` off an entity loaded with an explicit column list yields `undefined`, which
 * silently compares as `NaN` rather than failing - so any guard that has an entity in hand computes
 * from `amount` and `vat_rate` through here instead.
 *
 * Unsigned on purpose: `direction` decides which way the money went and is the caller's business.
 * The SQL twin applies that sign because it feeds SUMs over mixed directions; a guard comparing one
 * movement against one document wants the magnitude.
 */
export const toGrossAmount = (amount: number, vatRate: number): number => {
	return roundMoney((amount / 10 ** AMOUNT_DECIMALS) * (1 + vatRate / 100));
};

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Tracks cash flows.',
})
@Index('IDX_cash_flow_created_at', ['created_at'])
// No `category_type` equivalent: it is derived from `category` (see `getExpectedCategoryType`
// and the direction/amount @Check), so an index on it would duplicate this one
@Index('IDX_cash_flow_category_created_at', ['category', 'created_at'])
@Index('IDX_cash_flow_method_status', ['method', 'status'])
@Index('IDX_cash_flow_status_created_at', ['status', 'created_at'])
@Check(`
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
`)
@Check(`(amount > 0)`)
export default class CashFlowEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({
		type: 'enum',
		enum: CashFlowDirectionEnum,
		default: CashFlowDirectionEnum.IN,
		nullable: false,
	})
	direction!: CashFlowDirection;

	@Column({
		type: 'enum',
		enum: CashFlowCategoryTypeEnum,
		default: CashFlowCategoryTypeEnum.REVENUE,
		nullable: false,
	})
	category_type!: CashFlowCategoryType;

	@Column({
		type: 'enum',
		enum: CashFlowCategoryEnum,
		default: CashFlowCategoryEnum.CUSTOMER,
		nullable: false,
	})
	category!: CashFlowCategory;

	@Column({
		type: 'enum',
		enum: CashFlowMethodEnum,
		default: CashFlowMethodEnum.CASH,
		nullable: false,
	})
	method!: CashFlowMethod;

	@Column({
		type: 'enum',
		enum: CashFlowStatusEnum,
		default: CashFlowStatusEnum.PENDING,
		nullable: false,
	})
	status!: CashFlowStatus;

	@Column('int', {
		nullable: false,
		comment:
			'Amount intended to be charged; Note: Divide by 10000 for actual value. e.g. 806452 = 80.6452',
	})
	amount!: number;

	@Column('decimal', {
		precision: 5,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	vat_rate!: number;

	/*
	 * A validated `char(3)` rather than an enum, matching every other currency column in the
	 * codebase (`invoice`, `order_line`, `shipping`, `product_price`, `exchange_rate`). A ledger
	 * that could only name three codes cannot record the movement settling an invoice issued in a
	 * fourth - see `resolveBaseCurrency` in `exchange-rate.entity.ts` for the same reasoning about
	 * why the code is checked on the way in instead of constrained by the schema.
	 *
	 * The column default is a literal, not `Configuration.currency()`: a runtime env value baked
	 * into the schema would freeze whatever the machine that generated the migration happened to
	 * be configured with. The deployment's own currency is applied by the service on create.
	 */
	@Column('char', {
		length: CURRENCY_CODE_CHARS,
		default: 'RON',
		nullable: false,
	})
	currency!: string;

	@Column('decimal', {
		precision: 10,
		scale: 6,
		nullable: false,
		default: 1,
		comment:
			'Exchange rate to invoice base currency (default 1 = default currency)',
		transformer: numericTransformer,
	})
	exchange_rate!: number;

	// TRACKING
	@Column('varchar', { nullable: true })
	@Index('IDX_cash_flow_external_reference')
	external_reference!: string | null;

	@Column('int', {
		nullable: true,
		comment: 'Parent payment ID (e.g.: for refunds)',
	})
	@Index('IDX_cash_flow_parent_id')
	parent_id!: number | null;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@OneToMany(
		() => CashFlowEntity,
		(cashFlow: CashFlowEntity) => cashFlow.parent,
	)
	refunds!: CashFlowEntity[];

	@ManyToOne(
		() => CashFlowEntity,
		(cashFlow) => cashFlow.refunds,
		{
			nullable: true,
			onDelete: 'SET NULL',
		},
	)
	@JoinColumn({ name: 'parent_id' })
	parent!: CashFlowEntity | null;

	@OneToMany(
		() => OperationalRecordEntity,
		(operationalRecord) => operationalRecord.cash_flow,
	)
	operational_records!: OperationalRecordEntity[];

	// VIRTUAL
	@VirtualColumn({
		type: 'decimal',
		query: (alias) => ` CAST(${NET_AMOUNT_EXPRESSION(alias)} AS FLOAT)`,
	})
	net_amount!: number;

	@VirtualColumn({
		type: 'decimal',
		query: (alias) => `CAST(${GROSS_AMOUNT_EXPRESSION(alias)} AS FLOAT)`,
	})
	gross_amount!: number;
}
