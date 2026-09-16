import { Column, Entity, Index } from 'typeorm';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import { numericTransformer } from '@/shared/transformers/numeric.transformer';

/**
 * What a discount attaches to, which decides the link table its targets live in:
 * `client_discount`, `variant_discount`, `product_discount`, `category_discount`,
 * `brand_discount`. `order` is the exception - it takes no targets and applies to the
 * basket as a whole.
 *
 * Country is deliberately absent. It describes the buyer rather than the goods and its key
 * is a string code, so it stays a *condition* in `conditions.applicable_countries`, evaluated
 * after candidates are selected rather than used to select them.
 */
export const DiscountScopeEnum = {
	CLIENT: 'client',
	ORDER: 'order',
	PRODUCT: 'product',
	VARIANT: 'variant',
	CATEGORY: 'category',
	BRAND: 'brand',
} as const;

export type DiscountScope =
	(typeof DiscountScopeEnum)[keyof typeof DiscountScopeEnum];

export const DiscountTypeEnum = {
	PERCENT: 'percent',
	AMOUNT: 'amount',
} as const;

export type DiscountType =
	(typeof DiscountTypeEnum)[keyof typeof DiscountTypeEnum];

export const DiscountReasonEnum = {
	FLASH_SALE: 'flash_sale',
	FIRST_TIME_CUSTOMER: 'first_time_customer',
	LOYALTY_DISCOUNT: 'loyalty_discount',
	BIRTHDAY_DISCOUNT: 'birthday_discount',
	REFERRAL_DISCOUNT: 'referral_discount',
	VIP_DISCOUNT: 'vip_discount',
	SPECIAL_DISCOUNT: 'special_discount',
} as const;

export type DiscountReason =
	(typeof DiscountReasonEnum)[keyof typeof DiscountReasonEnum];

/**
 * A discount applies only when every condition it carries is met.
 *
 * **These are re-evaluated, not decided once.** `hour_range` and `day_range` depend on when
 * the question is asked, and `min_order_value` on a basket that is still being edited - so a
 * discount that qualifies when a product is added to the cart may not qualify when the order
 * is confirmed. Resolve again at confirmation and treat the snapshot on the order line as the
 * record of what was actually granted, never as a promise made earlier.
 *
 *   {
 *     "hour_range": [10, 18],           // hours of the day, inclusive
 *     "day_range": [1, 7],              // ISO weekday, Monday = 1
 *     "min_order_value": 100,           // base currency, excluding VAT
 *     "applicable_countries": ["RO"]
 *   }
 */
export type DiscountConditions = {
	/** Inclusive hour-of-day window, 0–23. Wraps when the first value is the larger one. */
	hour_range?: [number, number];
	/** Inclusive ISO weekday window, Monday = 1 through Sunday = 7. Wraps the same way. */
	day_range?: [number, number];
	/** Basket subtotal in the base currency, excluding VAT. */
	min_order_value?: number;
	/**
	 * ISO 3166-1 **alpha-2** codes, matched against the country the buyer's billing address
	 * resolves to (`place.alpha2_code`).
	 *
	 * Alpha-2 because it is the only vocabulary the whole codebase can share: the reader-side
	 * rule in `article_visibility_rule.allowed_countries` is compared against CDN geo headers
	 * (`getRequestCountry`), which emit alpha-2 and are not ours to change. `place.code` stays
	 * alpha-3 - it is the place seed's natural key, not a country rule's vocabulary.
	 */
	applicable_countries?: string[];
};

/** Every condition key, for validators and evaluators that need to enumerate them. */
export const DiscountConditionKeys = [
	'hour_range',
	'day_range',
	'min_order_value',
	'applicable_countries',
] as const satisfies readonly (keyof DiscountConditions)[];

export type DiscountSnapshot = {
	label: string;
	scope: DiscountScope;
	reason: DiscountReason;
	reference?: string | null;
	type: DiscountType;
	conditions?: DiscountConditions;
	value: number;
	/**
	 * The rule this came from, so reporting groups by it rather than by matching on `label` or
	 * `reference` - both of which an operator may edit after the document was raised.
	 *
	 * Optional because rows written before it existed carry none, and because the id is no use
	 * to a reader without the catalog behind it: the rest of the snapshot is what makes the
	 * document readable on its own.
	 */
	discount_id?: number;
	/**
	 * What this snapshot alone took off the line, in the line currency, after clamping.
	 *
	 * A line may carry several snapshots - its own best discount, then an order-wide campaign
	 * apportioned onto it - while `order_line.discount_reduction` is their **sum** and the only
	 * figure the VAT base is computed from. This is what splits that sum back up, and it cannot
	 * be replayed from `type` and `value` because neither carries the floor the figure was
	 * clamped to.
	 */
	reduction?: number;
};

const ENTITY_TABLE_NAME = 'discount';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Stores discount definitions. Note: Discount applied only for prices without VAT before exchange rate conversion',
})
@Index('IDX_discount_active', ['start_at', 'end_at', 'scope'])
export default class DiscountEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('varchar', { nullable: false, comment: 'Discount name' })
	label!: string;

	@Column({
		type: 'enum',
		enum: DiscountScopeEnum,
		nullable: false,
	})
	@Index('IDX_discount_scope')
	scope!: DiscountScope;

	@Column({
		type: 'enum',
		enum: DiscountReasonEnum,
		nullable: false,
	})
	@Index('IDX_discount_reason')
	reason!: DiscountReason;

	@Column('varchar', {
		nullable: true,
		comment: 'Coupon code, referral code, etc',
	})
	@Index('IDX_discount_reference')
	reference!: string | null;

	@Column({
		type: 'enum',
		enum: DiscountTypeEnum,
		nullable: false,
	})
	type!: DiscountType;

	@Column('jsonb', {
		nullable: true,
		comment:
			'Conditions the discount is subject to; all must be met for it to apply',
	})
	conditions?: DiscountConditions;

	// Transformed rather than left as the driver's string: the resolver compares a percentage
	// against an absolute amount by computing both, which is arithmetic, not text.
	@Column('decimal', {
		precision: 12,
		scale: 2,
		nullable: false,
		transformer: numericTransformer,
	})
	value!: number;

	@Column({ type: 'timestamp', nullable: true })
	start_at!: Date | null;

	@Column({ type: 'timestamp', nullable: true })
	end_at!: Date | null;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;
}
