import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type DiscountEntity from '@/features/discount/discount.entity';
import type {
	DiscountScope,
	DiscountScopeEnum,
} from '@/features/discount/discount.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

/**
 * What a target row points at - every discount scope except `order`, which applies to the
 * basket as a whole and therefore has nothing to point at, and `shipping`, which narrows itself
 * with `client` targets rather than having a target type of its own.
 */
type ScopeWithTargets = Exclude<
	DiscountScope,
	typeof DiscountScopeEnum.ORDER | typeof DiscountScopeEnum.SHIPPING
>;

// `satisfies` catches a target type that is not a scope.
export const DiscountTargetTypeEnum = {
	CLIENT: 'client',
	VARIANT: 'variant',
	PRODUCT: 'product',
	CATEGORY: 'category',
	BRAND: 'brand',
} as const satisfies Record<string, ScopeWithTargets>;

export type DiscountTargetType =
	(typeof DiscountTargetTypeEnum)[keyof typeof DiscountTargetTypeEnum];

/**
 * The other direction: a scope gaining targets without a type here is a missing key and so a
 * type error, rather than a branch the resolver could never reach.
 */
const _scopesHaveTargetTypes: Record<ScopeWithTargets, DiscountTargetType> = {
	client: DiscountTargetTypeEnum.CLIENT,
	variant: DiscountTargetTypeEnum.VARIANT,
	product: DiscountTargetTypeEnum.PRODUCT,
	category: DiscountTargetTypeEnum.CATEGORY,
	brand: DiscountTargetTypeEnum.BRAND,
};

const ENTITY_TABLE_NAME = 'discount_target';

/**
 * Everything a discount applies to, in one polymorphic table - the same shape as
 * `operational_record` in cash-flow.
 *
 * One table rather than one per target kind, for two reasons that matter more than the foreign
 * key it gives up:
 *
 * 1. **Direction.** A typed `category_discount` has to live in the `category` feature, which
 *    makes catalog features depend on `discount`. Discounts are the optional thing here; a
 *    shop should be installable without them. Owning the table on this side keeps every arrow
 *    pointing at `discount` and lets it stay a leaf.
 * 2. **One query.** The resolver asks "which discounts point at any of these things" for a
 *    basket line. Across five tables that is five round trips unioned in application code;
 *    here it is a single `WHERE (type, id) IN (…)` against one index.
 *
 * The cost is that `entity_id` carries no foreign key - it cannot, pointing at five tables -
 * so a deleted category can leave a row behind. Harmless (the resolver only ever matches ids
 * it was handed, so an orphan matches nothing) but it does accumulate, which is the trade
 * `operational_record` already makes.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'What a discount applies to; polymorphic by target_type, the window and conditions stay on the discount',
})
@Index(
	'IDX_discount_target_unique',
	['discount_id', 'target_type', 'entity_id'],
	{ unique: true, where: 'deleted_at IS NULL' },
)
// The resolver's lookup: "which discounts point at this category / brand / variant".
@Index('IDX_discount_target_entity', ['target_type', 'entity_id'])
export default class DiscountTargetEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	discount_id!: number;

	@Column({
		type: 'enum',
		enum: DiscountTargetTypeEnum,
		nullable: false,
	})
	target_type!: DiscountTargetType;

	// No foreign key by design - see the class comment. The id is meaningful only together
	// with `target_type`.
	@Column('int', { nullable: false })
	entity_id!: number;

	// RELATIONS
	// CASCADE: the link has no meaning once the discount is gone, and a discount already applied
	// to an order survives as a snapshot on the order line rather than through this row
	@ManyToOne('DiscountEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'discount_id' })
	discount!: DiscountEntity;
}
