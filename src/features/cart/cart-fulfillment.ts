import type { WarehouseAvailability } from '@/features/cart/cart.hooks';
import { compareIds } from '@/helpers/id.helper';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Which warehouse each part of a checkout leaves from. Pure, so the rules can be exercised without
 * a database; checkout feeds it the per-site figures `resolveWarehouseAvailability` answers.
 *
 * The rules, in the order they outrank each other:
 *
 * 1. **Fewest deliveries.** Nothing else is weighed against the parcel count.
 * 2. **One warehouse whenever one can fill the order** - the default when it qualifies, otherwise
 *    the qualifying site holding the most of the order's goods.
 * 3. **Whole lines before split lines.** At a given parcel count, a set of sites where every line
 *    comes whole from one of them beats a set that has to divide a variant between two.
 * 4. **Among sets of the same size and kind**: one including the default, then the most stock
 *    held by the sites chosen for the lines the default cannot fill (a variant only secondary
 *    sites hold goes to the one holding the most of it), then the lower ids.
 *
 * Inside the chosen set a line the default can fill stays on the default, and any other goes to
 * the site holding the most of it. A line no site in the set can fill whole is divided biggest
 * stock first.
 *
 * What no site can supply - an untracked variant, or a backordered shortfall - travels with the
 * delivery that already carries the most of that variant, or with the first delivery, so it never
 * adds a parcel of its own.
 */

export type FulfillmentLine = {
	variant_id: EntityId;
	product_id: EntityId;
	quantity: number;
};

export type FulfillmentGroup = {
	warehouse_id: EntityId;
	lines: FulfillmentLine[];
};

/**
 * Bound on the sites the exhaustive search weighs. Every subset of the candidates may be tried, so
 * the cost doubles per site: 10 keeps the worst case at ~1k subsets times the order's lines. Past
 * it the sites holding the most of the order are kept, which can miss a smaller set only when an
 * order spans more than ten warehouses.
 */
const MAX_CANDIDATE_WAREHOUSES = 10;

/** Quantities are `numeric(12,2)`; a divided line is rounded back to that scale. */
function roundQuantity(value: number): number {
	return Math.round(value * 100) / 100;
}

type Demand = {
	variant_id: EntityId;
	/** What the sites can supply of the line - its quantity, capped at what they hold together. */
	quantity: number;
	/** Positive stock per candidate site. */
	stock: Map<EntityId, number>;
};

type Candidate = {
	sites: EntityId[];
	whole: boolean;
	hasDefault: boolean;
	score: number;
};

function stockAt(demand: Demand, warehouseId: EntityId): number {
	return demand.stock.get(warehouseId) ?? 0;
}

function* combinations<T>(items: readonly T[], size: number): Generator<T[]> {
	const picked: T[] = [];

	function* walk(start: number): Generator<T[]> {
		if (picked.length === size) {
			yield [...picked];

			return;
		}

		for (let i = start; i <= items.length - (size - picked.length); i++) {
			picked.push(items[i]);
			yield* walk(i + 1);
			picked.pop();
		}
	}

	yield* walk(0);
}

/** Sites with something to give, the default first, then by how much of the order each holds. */
function rankCandidates(
	demands: readonly Demand[],
	defaultWarehouseId: EntityId,
): EntityId[] {
	const held = new Map<EntityId, { lines: number; units: number }>();

	for (const demand of demands) {
		for (const [warehouseId, quantity] of demand.stock) {
			const entry = held.get(warehouseId) ?? { lines: 0, units: 0 };

			entry.lines += quantity >= demand.quantity ? 1 : 0;
			entry.units += Math.min(quantity, demand.quantity);
			held.set(warehouseId, entry);
		}
	}

	return [...held.entries()]
		.sort(
			([aId, a], [bId, b]) =>
				Number(bId === defaultWarehouseId) -
					Number(aId === defaultWarehouseId) ||
				b.lines - a.lines ||
				b.units - a.units ||
				compareIds(aId, bId),
		)
		.slice(0, MAX_CANDIDATE_WAREHOUSES)
		.map(([warehouseId]) => warehouseId);
}

function evaluate(
	sites: EntityId[],
	demands: readonly Demand[],
	defaultWarehouseId: EntityId,
): Candidate | null {
	const hasDefault = sites.includes(defaultWarehouseId);
	let whole = true;
	let score = 0;

	for (const demand of demands) {
		const fillsWhole = sites.some(
			(site) => stockAt(demand, site) >= demand.quantity,
		);

		if (!fillsWhole) {
			const together = sites.reduce(
				(sum, site) => sum + stockAt(demand, site),
				0,
			);

			if (together < demand.quantity) {
				return null;
			}

			whole = false;
		}

		if (
			hasDefault &&
			stockAt(demand, defaultWarehouseId) >= demand.quantity
		) {
			continue;
		}

		score += Math.max(...sites.map((site) => stockAt(demand, site)));
	}

	return { sites: sites, whole: whole, hasDefault: hasDefault, score: score };
}

/** Negative when `a` is the better set; both are the same size. */
function compare(a: Candidate, b: Candidate): number {
	return (
		Number(b.whole) - Number(a.whole) ||
		Number(b.hasDefault) - Number(a.hasDefault) ||
		b.score - a.score ||
		a.sites.join(',').localeCompare(b.sites.join(','), 'en', {
			numeric: true,
		})
	);
}

/** The smallest set of sites that can fill every demand, best first by `compare`. */
function chooseSites(
	demands: readonly Demand[],
	candidates: readonly EntityId[],
	defaultWarehouseId: EntityId,
): EntityId[] {
	const sorted = [...candidates].sort(compareIds);

	for (let size = 1; size <= sorted.length; size++) {
		let best: Candidate | null = null;

		for (const sites of combinations(sorted, size)) {
			const candidate = evaluate(sites, demands, defaultWarehouseId);

			if (candidate && (!best || compare(candidate, best) < 0)) {
				best = candidate;
			}
		}

		if (best) {
			return best.sites;
		}
	}

	// Unreachable: demands are capped at what the candidates hold together
	return [];
}

/** How a demand's quantity divides over the chosen sites. */
function assign(
	demand: Demand,
	sites: readonly EntityId[],
	defaultWarehouseId: EntityId,
): Map<EntityId, number> {
	if (
		sites.includes(defaultWarehouseId) &&
		stockAt(demand, defaultWarehouseId) >= demand.quantity
	) {
		return new Map([[defaultWarehouseId, demand.quantity]]);
	}

	const byStock = [...sites]
		.filter((site) => stockAt(demand, site) > 0)
		.sort(
			(a, b) =>
				stockAt(demand, b) - stockAt(demand, a) || compareIds(a, b),
		);

	const whole = byStock.find(
		(site) => stockAt(demand, site) >= demand.quantity,
	);

	if (whole !== undefined) {
		return new Map([[whole, demand.quantity]]);
	}

	const parts = new Map<EntityId, number>();
	let left = demand.quantity;

	for (const site of byStock) {
		if (left <= 0) {
			break;
		}

		const take = roundQuantity(Math.min(left, stockAt(demand, site)));

		parts.set(site, take);
		left = roundQuantity(left - take);
	}

	return parts;
}

/**
 * Splits `lines` into one group per warehouse they leave from, the group that carries the delivery
 * fee first: the default's when it sends anything, otherwise the one with the most lines.
 *
 * `availability` is read for the variants it names only; any other line has no stock kept and is
 * placed by the "what no site can supply" rule. With nothing tracked, or nothing anywhere, the
 * answer is a single group from the default - the same delivery a checkout wrote before stock was
 * kept per site.
 */
export function planDeliveries(
	lines: readonly FulfillmentLine[],
	availability: WarehouseAvailability,
	defaultWarehouseId: EntityId,
): FulfillmentGroup[] {
	const raw: Demand[] = lines.flatMap((line) => {
		const sites = availability.get(line.variant_id);

		if (!sites) {
			return [];
		}

		const stock = new Map(
			[...sites].filter(([, quantity]) => quantity > 0),
		);

		return stock.size === 0
			? []
			: [{ variant_id: line.variant_id, quantity: line.quantity, stock }];
	});

	const candidates = rankCandidates(raw, defaultWarehouseId);
	const kept = new Set(candidates);

	// Restricted to the kept sites, and capped at what they hold between them
	const demands = raw.flatMap((demand) => {
		const stock = new Map(
			[...demand.stock].filter(([site]) => kept.has(site)),
		);
		const together = [...stock.values()].reduce((a, b) => a + b, 0);

		return stock.size === 0
			? []
			: [
					{
						...demand,
						stock,
						quantity: roundQuantity(
							Math.min(demand.quantity, together),
						),
					},
				];
	});

	if (demands.length === 0) {
		return [{ warehouse_id: defaultWarehouseId, lines: [...lines] }];
	}

	const sites = chooseSites(demands, candidates, defaultWarehouseId);
	const assigned = new Map(
		demands.map((demand) => [
			demand.variant_id,
			assign(demand, sites, defaultWarehouseId),
		]),
	);

	const groups = new Map<EntityId, FulfillmentLine[]>(
		sites.map((site) => [site, []]),
	);

	for (const line of lines) {
		const parts = assigned.get(line.variant_id);

		if (!parts) {
			continue;
		}

		for (const [site, quantity] of parts) {
			groups.get(site)?.push({ ...line, quantity: quantity });
		}
	}

	const ordered = [...groups.entries()]
		.filter(([, groupLines]) => groupLines.length > 0)
		.sort(
			([aId, a], [bId, b]) =>
				Number(bId === defaultWarehouseId) -
					Number(aId === defaultWarehouseId) ||
				b.length - a.length ||
				compareIds(aId, bId),
		)
		.map(([warehouseId, groupLines]) => ({
			warehouse_id: warehouseId,
			lines: groupLines,
		}));

	// What no site supplies rides with the group already carrying most of the variant, else the first
	for (const line of lines) {
		const parts = assigned.get(line.variant_id);
		const supplied = parts
			? [...parts.values()].reduce((a, b) => a + b, 0)
			: 0;
		const rest = roundQuantity(line.quantity - supplied);

		if (rest <= 0) {
			continue;
		}

		const mainSite = parts
			? [...parts].sort(
					([aSite, aQuantity], [bSite, bQuantity]) =>
						bQuantity - aQuantity || compareIds(aSite, bSite),
				)[0]?.[0]
			: undefined;
		const carrier =
			ordered.find((group) => group.warehouse_id === mainSite) ??
			ordered[0];

		const existing = carrier.lines.find(
			(groupLine) => groupLine.variant_id === line.variant_id,
		);

		if (existing) {
			existing.quantity = roundQuantity(existing.quantity + rest);
		} else {
			carrier.lines.push({ ...line, quantity: rest });
		}
	}

	return ordered;
}
