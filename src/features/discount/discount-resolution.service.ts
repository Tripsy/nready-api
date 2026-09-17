import dataSource from '@/config/data-source.config';
import DiscountEntity, {
	DiscountConditionKeys,
	type DiscountConditions,
	DiscountScopeEnum,
	type DiscountSnapshot,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';
import DiscountTargetEntity, {
	type DiscountTargetType,
	DiscountTargetTypeEnum,
} from '@/features/discount/discount-target.entity';
import { isoWeekday } from '@/helpers/date.helper';
import { apportion, roundMoney } from '@/helpers/shop.helper';

/**
 * What every condition is judged against, whichever scope is being resolved.
 *
 * Money splits across two currencies and mixing them is the easy mistake here, so each field
 * says which one it is in. `exchangeRate` follows `order_line.exchange_rate` - "rate to the
 * base currency", so `base = sale × rate` and `sale = base ÷ rate`, and it is 1 when the sale
 * is already in base currency.
 */
export type DiscountBasketContext = {
	/**
	 * Omitted by a caller that holds no rate, and read as 1. A cart quotes in the shopper's own
	 * currency and resolves no rate at all - only a document does, when it is raised - so for a
	 * basket an `amount` discount and `min_order_value` are read as if the sale currency were the
	 * base one. A document always states it.
	 */
	exchangeRate?: number;

	/**
	 * Basket subtotal excluding VAT, sale currency, for `min_order_value`.
	 *
	 * **Gross - before any discount.** A threshold tested against a figure the discounts have
	 * already moved is circular: applying one drops the basket back under its own bar, and with
	 * an order-wide campaign stacking on top of the line discounts there is no order to evaluate
	 * the two in that settles it. So both passes read the same untouched subtotal.
	 */
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

/** Everything the resolver needs about one basket line, on top of the basket it sits in. */
export type DiscountLineContext = DiscountBasketContext & {
	clientId?: number | null;
	variantId: number;
	productId: number;
	brandId?: number | null;
	/** The product's own categories. Ancestors are expanded here, not by the caller. */
	categoryIds?: readonly number[];

	quantity: number;
	/** Unit price excluding VAT, in the sale currency. */
	unitPrice: number;

	/** `product_price.min_price` - sale currency, already market-specific. */
	minPrice?: number | null;
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
 * `scope = 'order'` never appears here: those apply to the basket as a whole and are resolved by
 * `findOrderCandidates` in a pass of their own. Folding them in would charge them once per line.
 *
 * `scope = 'shipping'` is excluded explicitly, because unlike `order` it does carry targets: a
 * free-delivery rule for one client is a `client` target row, and matched here it would take the
 * same percentage off every product that client buys. It reduces the shipment, in
 * `findShippingCandidates`.
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
		.andWhere('discount.scope != :shippingScope', {
			shippingScope: DiscountScopeEnum.SHIPPING,
		})
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

/**
 * True when every rule on the discount is satisfied by the basket the question is asked about.
 *
 * Takes the basket half of the context rather than a whole line: no condition key names a line,
 * and an order-wide campaign has no line to offer.
 */
export function evaluateConditions(
	conditions: DiscountConditions | undefined | null,
	context: DiscountBasketContext,
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

/**
 * The document's own record of a rule that fired.
 *
 * `reduction` is stated by the caller because only it knows what survived clamping, and a line
 * may carry two of these - see `DiscountSnapshot`.
 */
export function buildSnapshot(
	discount: DiscountEntity,
	reduction?: number,
): DiscountSnapshot {
	return {
		label: discount.label,
		scope: discount.scope,
		reason: discount.reason,
		reference: discount.reference,
		type: discount.type,
		conditions: discount.conditions,
		value: Number(discount.value),
		discount_id: discount.id,
		...(reduction === undefined ? {} : { reduction: reduction }),
	};
}

/**
 * One line as the order-wide pass sees it: what it still costs, and how much of that it may
 * give up.
 */
export type OrderDiscountBasis = {
	/**
	 * What the line costs after its own discount, sale currency, VAT excluded. It is both the
	 * apportionment weight and a ceiling - a campaign cannot take more off a line than is left
	 * on it.
	 */
	net: number;
	/**
	 * The most this line may **still** give up before it reaches `product_price.min_price`, with
	 * whatever the line-scope pass already took off it already deducted.
	 *
	 * `null` when the market states no floor, where the only bound is `net`. The caller computes
	 * it because only it holds the floor and knows what the first pass spent.
	 */
	headroom?: number | null;
};

export type ResolvedOrderDiscount = {
	discount: DiscountEntity;
	/** Carries the campaign's whole `reduction`; each line also records the share it took. */
	snapshot: DiscountSnapshot;
	/** Per line, index-aligned with the basis handed in. */
	reductions: number[];
	/** Sum of `reductions`, sale currency. */
	reduction: number;
};

/**
 * Every live order-wide discount, in one query.
 *
 * No join to `discount_target`, unlike `findCandidates`: `scope = 'order'` takes no targets by
 * construction - `ScopeWithTargets` excludes it - so the scope column is the whole selection.
 */
async function findOrderCandidates(
	context: DiscountBasketContext,
): Promise<DiscountEntity[]> {
	const now = context.now ?? new Date();

	return dataSource
		.getRepository(DiscountEntity)
		.createQueryBuilder('discount')
		.where('discount.scope = :scope', { scope: DiscountScopeEnum.ORDER })
		.andWhere('discount.deleted_at IS NULL')
		.andWhere('(discount.start_at IS NULL OR discount.start_at <= :now)', {
			now,
		})
		.andWhere('(discount.end_at IS NULL OR discount.end_at >= :now)', {
			now,
		})
		.getMany();
}

/**
 * What an order-wide discount takes off each line.
 *
 * The campaign is costed once against the basket, then apportioned pro-rata by what each line
 * still costs - so every line gives up its share **at its own VAT rate**. One figure held over
 * the whole document could not do that, and VAT is owed per line.
 *
 * ⚠️ **A clamped line loses its share rather than passing it on.** Where a floor bites, the
 * campaign takes less than its headline figure. Redistributing the remainder needs a second pass
 * that can breach another line's floor in turn, and what the document records has to be a figure
 * it can explain.
 */
export function computeOrderReductions(
	discount: DiscountEntity,
	basis: readonly OrderDiscountBasis[],
	exchangeRate?: number,
): number[] {
	const nets = basis.map((line) => Math.max(0, roundMoney(line.net)));
	const basketNet = roundMoney(nets.reduce((sum, net) => sum + net, 0));

	if (basketNet <= 0) {
		return basis.map(() => 0);
	}

	const raw =
		discount.type === DiscountTypeEnum.PERCENT
			? (basketNet * Number(discount.value)) / 100
			: Number(discount.value) / (exchangeRate ?? 1);

	// Nothing comes off beyond what the basket still costs, whatever the campaign is worth.
	const shares = apportion(Math.min(roundMoney(raw), basketNet), nets);

	return shares.map((share, index) => {
		const headroom = basis[index].headroom;
		const ceiling =
			headroom === null || headroom === undefined
				? nets[index]
				: Math.min(headroom, nets[index]);

		return roundMoney(Math.max(0, Math.min(share, ceiling)));
	});
}

/** What the shipping pass needs: the basket it is judged against, the buyer, and the price. */
export type DiscountShippingContext = DiscountBasketContext & {
	clientId?: number | null;
	/** The shipment price excluding VAT, sale currency. */
	price: number;
};

export type ResolvedShippingDiscount = {
	discount: DiscountEntity;
	/** Money off the shipment price, sale currency, VAT excluded. */
	reduction: number;
	snapshot: DiscountSnapshot;
};

/**
 * Every live shipping discount that could apply to this buyer, in one query.
 *
 * A rule with no targets is for everyone; a rule with targets names the clients it is for, and only
 * `client` rows count - the targets endpoint refuses any other type on this scope, so the filter is
 * a guard for rows written before that check rather than a rule of its own. Without a client (a
 * basket nobody has chosen a buyer for yet) only the untargeted rules can match.
 */
async function findShippingCandidates(
	context: DiscountShippingContext,
): Promise<DiscountEntity[]> {
	const now = context.now ?? new Date();

	const targeted = `EXISTS (
		SELECT 1 FROM discount_target target
		WHERE target.discount_id = discount.id AND target.deleted_at IS NULL
	)`;

	const query = dataSource
		.getRepository(DiscountEntity)
		.createQueryBuilder('discount')
		.where('discount.scope = :scope', { scope: DiscountScopeEnum.SHIPPING })
		.andWhere('discount.deleted_at IS NULL')
		.andWhere('(discount.start_at IS NULL OR discount.start_at <= :now)', {
			now,
		})
		.andWhere('(discount.end_at IS NULL OR discount.end_at >= :now)', {
			now,
		});

	if (!context.clientId) {
		return query.andWhere(`NOT ${targeted}`).getMany();
	}

	return query
		.andWhere(
			`(NOT ${targeted} OR EXISTS (
				SELECT 1 FROM discount_target client_target
				WHERE client_target.discount_id = discount.id
					AND client_target.deleted_at IS NULL
					AND client_target.target_type = :clientType
					AND client_target.entity_id = :clientId
			))`,
			{
				clientType: DiscountTargetTypeEnum.CLIENT,
				clientId: context.clientId,
			},
		)
		.getMany();
}

/**
 * Money off a shipment price, sale currency, VAT excluded.
 *
 * An `amount` is base currency like every absolute figure on a discount, so it is converted at the
 * rate. Nothing comes off beyond the price: a shipment has no floor of its own the way a product has
 * `min_price`, so free is the limit.
 */
export function computeShippingReduction(
	discount: DiscountEntity,
	price: number,
	exchangeRate?: number,
): number {
	const raw =
		discount.type === DiscountTypeEnum.PERCENT
			? (price * Number(discount.value)) / 100
			: Number(discount.value) / (exchangeRate ?? 1);

	return roundMoney(Math.max(0, Math.min(raw, price)));
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
					snapshot: buildSnapshot(discount, reduction),
				};
			}
		}

		return best;
	}

	/**
	 * The single best order-wide campaign for a basket, or null when none applies.
	 *
	 * Costed the way `resolveForLine` is - largest reduction wins outright, ties to the lowest id
	 * - except that what is compared is the figure taken off the **whole** basket. That is why
	 * the lines are handed over rather than just their total: a floor on one of them changes what
	 * a campaign is worth overall, so two campaigns cannot be ranked without pricing both.
	 *
	 * It applies **on top of** whatever the line-scope pass granted, which is what `basis`
	 * already has deducted.
	 */
	public async resolveForOrder(
		context: DiscountBasketContext,
		basis: readonly OrderDiscountBasis[],
	): Promise<ResolvedOrderDiscount | null> {
		if (basis.length === 0) {
			return null;
		}

		const candidates = await findOrderCandidates(context);

		let best: ResolvedOrderDiscount | null = null;

		for (const discount of candidates) {
			if (!evaluateConditions(discount.conditions, context)) {
				continue;
			}

			const reductions = computeOrderReductions(
				discount,
				basis,
				context.exchangeRate,
			);
			const reduction = roundMoney(
				reductions.reduce((sum, value) => sum + value, 0),
			);

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
					discount: discount,
					snapshot: buildSnapshot(discount, reduction),
					reductions: reductions,
					reduction: reduction,
				};
			}
		}

		return best;
	}

	/**
	 * The single best shipping discount for one shipment, or null when none applies.
	 *
	 * Its own pass, and it **stacks with both goods passes**: it reduces a different figure - the
	 * shipment's price rather than any line - so there is nothing for it to compete with. Ranked the
	 * way the other two are: largest reduction wins outright, ties to the lowest id.
	 *
	 * `min_order_value` is read against the goods subtotal in `orderValue`, which is what "free
	 * delivery over 200" means to the buyer - the shipment's own price never counts toward it.
	 */
	public async resolveForShipping(
		context: DiscountShippingContext,
	): Promise<ResolvedShippingDiscount | null> {
		if (context.price <= 0) {
			return null;
		}

		const candidates = await findShippingCandidates(context);

		let best: ResolvedShippingDiscount | null = null;

		for (const discount of candidates) {
			if (!evaluateConditions(discount.conditions, context)) {
				continue;
			}

			const reduction = computeShippingReduction(
				discount,
				context.price,
				context.exchangeRate,
			);

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
					discount: discount,
					reduction: reduction,
					snapshot: buildSnapshot(discount, reduction),
				};
			}
		}

		return best;
	}
}

export const discountResolutionService = new DiscountResolutionService();
