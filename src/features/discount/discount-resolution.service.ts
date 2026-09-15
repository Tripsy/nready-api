import dataSource from '@/config/data-source.config';
import DiscountEntity, {
	DiscountConditionKeys,
	type DiscountConditions,
	type DiscountSnapshot,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';
import DiscountTargetEntity, {
	type DiscountTargetType,
	DiscountTargetTypeEnum,
} from '@/features/discount/discount-target.entity';
import { isoWeekday } from '@/helpers/date.helper';
import { roundMoney } from '@/helpers/shop.helper';

/**
 * Everything the resolver needs about one basket line.
 *
 * Money splits across two currencies and mixing them is the easy mistake here, so each field
 * says which one it is in. `exchangeRate` follows `order_line.exchange_rate` - "rate to the
 * base currency", so `base = sale × rate` and `sale = base ÷ rate`, and it is 1 when the sale
 * is already in base currency.
 */
export type DiscountLineContext = {
	clientId?: number | null;
	variantId: number;
	productId: number;
	brandId?: number | null;
	/** The product's own categories. Ancestors are expanded here, not by the caller. */
	categoryIds?: readonly number[];

	quantity: number;
	/** Unit price excluding VAT, in the sale currency. */
	unitPrice: number;
	/**
	 * Omitted by a caller that holds no rate, and read as 1. A cart quotes in the shopper's own
	 * currency and resolves no rate at all - only a document does, when it is raised - so for a
	 * basket an `amount` discount and `min_order_value` are read as if the sale currency were the
	 * base one. A document always states it.
	 */
	exchangeRate?: number;

	/** `product_price.min_price` - sale currency, already market-specific. */
	minPrice?: number | null;

	/** Basket subtotal excluding VAT, sale currency, for `min_order_value`. */
	orderValue?: number;
	/** Buyer country for `applicable_countries`. */
	countryCode?: string | null;

	/**
	 * The moment the question is being asked, for `hour_range` and `day_range` - and for the
	 * discount's own window. Injectable so a test is not at the mercy of the clock, and so a
	 * caller re-resolving an order can ask "did this hold at confirmation time".
	 */
	now?: Date;
};

export type ResolvedDiscount = {
	discount: DiscountEntity;
	/** Money off the whole line, in the sale currency, rounded to 2dp. */
	reduction: number;
	snapshot: DiscountSnapshot;
};

/**
 * Condition keys the evaluator understands, which is every key `DiscountConditions` allows.
 * Anything else makes the discount **not apply**.
 *
 * Failing closed is deliberate: a typo like `min_order_vaule` that failed open would silently
 * drop the guard and hand out a discount nobody authorized. An unapplied discount gets noticed
 * and fixed; an over-applied one gets noticed in the accounts. The validator rejects unknown
 * keys at the boundary, so reaching this branch means data that predates the closed key set.
 */
const KNOWN_CONDITION_KEYS = new Set<string>(DiscountConditionKeys);

/**
 * Inclusive range test that also accepts a window wrapping past the end of the cycle - 22:00
 * to 04:00, or Friday to Monday - which reads naturally to whoever sets it and would otherwise
 * be an empty range.
 */
function inCyclicRange(value: number, [from, to]: [number, number]): boolean {
	return from <= to
		? value >= from && value <= to
		: value >= from || value <= to;
}

/** Expands categories to themselves plus every ancestor, so a discount on "Shoes" reaches "Shoes > Running". */
async function expandCategoryAncestors(
	categoryIds: readonly number[],
): Promise<number[]> {
	if (categoryIds.length === 0) {
		return [];
	}

	/*
	 * `category` is a `@Tree('closure-table')`, so TypeORM maintains `category_closure` with
	 * one row per ancestor/descendant pair - including the self-pair. One join therefore
	 * replaces a recursive walk, and re-parenting a category moves its discounts with it
	 * because the closure rows are rebuilt by TypeORM, not by us.
	 */
	const rows: { id_ancestor: number }[] = await dataSource.query(
		`SELECT DISTINCT id_ancestor FROM category_closure WHERE id_descendant = ANY($1)`,
		[[...categoryIds]],
	);

	return [...new Set([...categoryIds, ...rows.map((r) => r.id_ancestor)])];
}

/**
 * The entity ids this line could match, grouped by target type - every category ancestor
 * included, so a discount on "Shoes" reaches a product in "Shoes > Running".
 */
async function buildTargetGroups(
	context: DiscountLineContext,
): Promise<Map<DiscountTargetType, number[]>> {
	const groups = new Map<DiscountTargetType, number[]>([
		[DiscountTargetTypeEnum.VARIANT, [context.variantId]],
		[DiscountTargetTypeEnum.PRODUCT, [context.productId]],
	]);

	if (context.clientId) {
		groups.set(DiscountTargetTypeEnum.CLIENT, [context.clientId]);
	}

	if (context.brandId) {
		groups.set(DiscountTargetTypeEnum.BRAND, [context.brandId]);
	}

	const categoryIds = await expandCategoryAncestors(
		context.categoryIds ?? [],
	);

	if (categoryIds.length > 0) {
		groups.set(DiscountTargetTypeEnum.CATEGORY, categoryIds);
	}

	return groups;
}

/**
 * Every live discount linked to anything on this line, in one query.
 *
 * Targets are polymorphic, so all five kinds live in one table and the lookup is a single
 * statement joined to the discount for its window - one round trip however many category
 * ancestors turned up. A table per target kind cost a query each plus a union in application
 * code.
 *
 * One `OR` group per target type rather than a row-value `IN ((type, id), …)`: Postgres will
 * not accept a parameterized list of anonymous composites ("input of anonymous composite types
 * is not implemented"). Each group is an equality on `target_type` and an `IN` on `entity_id`,
 * which is exactly the shape `IDX_discount_target_entity` is built for.
 *
 * `scope = 'order'` never appears here: those apply to the basket as a whole and are a separate
 * application step. Folding them in would charge them once per line.
 */
async function findCandidates(
	context: DiscountLineContext,
): Promise<DiscountEntity[]> {
	const groups = await buildTargetGroups(context);

	if (groups.size === 0) {
		return [];
	}

	const clauses: string[] = [];
	const parameters: Record<string, unknown> = {};

	let index = 0;

	for (const [targetType, entityIds] of groups) {
		clauses.push(
			`(target.target_type = :type${index} AND target.entity_id IN (:...ids${index}))`,
		);

		parameters[`type${index}`] = targetType;
		parameters[`ids${index}`] = entityIds;

		index++;
	}

	const now = context.now ?? new Date();

	return dataSource
		.getRepository(DiscountEntity)
		.createQueryBuilder('discount')
		.innerJoin(
			DiscountTargetEntity,
			'target',
			'target.discount_id = discount.id AND target.deleted_at IS NULL',
		)
		.where(`(${clauses.join(' OR ')})`, parameters)
		.andWhere('discount.deleted_at IS NULL')
		.andWhere('(discount.start_at IS NULL OR discount.start_at <= :now)', {
			now,
		})
		.andWhere('(discount.end_at IS NULL OR discount.end_at >= :now)', {
			now,
		})
		.distinct(true)
		.getMany();
}

/** True when every rule on the discount is satisfied by the line and its basket. */
export function evaluateConditions(
	conditions: DiscountConditions | undefined | null,
	context: DiscountLineContext,
): boolean {
	if (!conditions) {
		return true;
	}

	const now = context.now ?? new Date();

	for (const [key, value] of Object.entries(conditions)) {
		if (!KNOWN_CONDITION_KEYS.has(key)) {
			return false;
		}

		switch (key) {
			case 'min_order_value': {
				// `value` is base currency, like every other absolute figure on a discount.
				const orderValueInBase =
					(context.orderValue ?? 0) * (context.exchangeRate ?? 1);

				if (orderValueInBase < Number(value)) {
					return false;
				}

				break;
			}

			case 'hour_range': {
				if (!inCyclicRange(now.getHours(), value as [number, number])) {
					return false;
				}

				break;
			}

			case 'day_range': {
				if (
					!inCyclicRange(isoWeekday(now), value as [number, number])
				) {
					return false;
				}

				break;
			}

			case 'applicable_countries': {
				const allowed = (Array.isArray(value) ? value : []).map(
					(code) => String(code).toUpperCase(),
				);

				if (
					!context.countryCode ||
					!allowed.includes(context.countryCode.toUpperCase())
				) {
					return false;
				}

				break;
			}
		}
	}

	return true;
}

/**
 * The lowest unit price a discount may resolve to, in the sale currency.
 *
 * `min_price` is the whole rule: a deliberate per-market commercial decision, which may
 * legitimately sit below cost for a campaign. Absent, there is no floor - the only remaining
 * guard is that a line cannot go negative.
 *
 * **Cost is deliberately not a fallback.** What the goods cost is an accounting figure and must
 * not move what a customer is charged: a floor derived from it would make the sale price of two
 * identical items differ by their purchase history, and would shift under a variant the moment a
 * goods receipt recomputes the weighted average. A seller who wants cost respected states it as a
 * `min_price`, in the market's own currency, where it is visible and auditable.
 */
function resolveFloor(context: DiscountLineContext): number | null {
	return context.minPrice ?? null;
}

/**
 * Money off the whole line, after clamping.
 *
 * An `amount` discount is per unit, matching `percent`, which is inherently per unit - a line
 * of three gets the discount three times either way.
 */
export function computeReduction(
	discount: DiscountEntity,
	context: DiscountLineContext,
): number {
	const rawPerUnit =
		discount.type === DiscountTypeEnum.PERCENT
			? (context.unitPrice * Number(discount.value)) / 100
			: Number(discount.value) / (context.exchangeRate ?? 1);

	const floor = resolveFloor(context);

	const maxPerUnit =
		floor === null
			? context.unitPrice
			: Math.max(0, context.unitPrice - floor);

	return roundMoney(
		Math.max(0, Math.min(rawPerUnit, maxPerUnit)) * context.quantity,
	);
}

export function buildSnapshot(discount: DiscountEntity): DiscountSnapshot {
	return {
		label: discount.label,
		scope: discount.scope,
		reason: discount.reason,
		reference: discount.reference,
		type: discount.type,
		conditions: discount.conditions,
		value: Number(discount.value),
	};
}

export class DiscountResolutionService {
	/**
	 * The single best discount for one basket line, or null when nothing applies.
	 *
	 * Every candidate is costed and the largest reduction wins outright - there is no scope
	 * precedence, so a product promotion can beat a client's own discount. Ties go to the
	 * lowest id, which keeps the outcome stable across reruns rather than leaving it to row
	 * order.
	 */
	public async resolveForLine(
		context: DiscountLineContext,
	): Promise<ResolvedDiscount | null> {
		const candidates = await findCandidates(context);

		let best: ResolvedDiscount | null = null;

		for (const discount of candidates) {
			if (!evaluateConditions(discount.conditions, context)) {
				continue;
			}

			const reduction = computeReduction(discount, context);

			if (reduction <= 0) {
				continue;
			}

			const isBetter =
				best === null ||
				reduction > best.reduction ||
				(reduction === best.reduction &&
					discount.id < best.discount.id);

			if (isBetter) {
				best = {
					discount,
					reduction,
					snapshot: buildSnapshot(discount),
				};
			}
		}

		return best;
	}
}

export const discountResolutionService = new DiscountResolutionService();
