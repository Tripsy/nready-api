import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';

/** A bundle's components, sorted into the three cases `product.md` §8.1 defines. */
export type LoadedComposition = {
	/** Case 1 - no group, not optional. Part of the kit, covered by the bundle's own price. */
	mandatory: ProductBundleItemEntity[];
	/** Case 2 - no group, optional. An independent tick box taking 0..`quantity` units. */
	optional: ProductBundleItemEntity[];
	/** Case 3 - grouped candidates, keyed by `group_id`. Exactly one of each group is taken. */
	candidatesByGroup: Map<number, ProductBundleItemEntity[]>;
	/** Every component row of the bundle, whichever case, by id. */
	byId: Map<number, ProductBundleItemEntity>;
};

/** What the shopper picked: a component row, and for a tick box how many units of it. */
export type BundleChoice = {
	item_id: number;
	/** Units taken. Meaningful on a tick box only; a candidate contributes its own `quantity`. */
	units?: number;
};

/** One component as it is actually taken, after the catalog has had its say. */
export type ResolvedComponent = {
	item: ProductBundleItemEntity;
	/** Units per **one** bundle, never multiplied by the cart line's own quantity. */
	units: number;
	/** True for case 1 - the bundle's headline price already covers it, so it adds nothing. */
	included: boolean;
};

/** Why a set of picks cannot stand against the bundle's composition. */
export type BundleSelectionProblem =
	| { reason: 'foreign_component' }
	| { reason: 'included_component'; item_id: number }
	| { reason: 'group_unanswered'; group_id: number }
	| { reason: 'group_multiple'; group_id: number }
	| { reason: 'over_ceiling'; item_id: number; max: number };

/**
 * The bundle counterpart of `ProductOptionSelectionService`, and deliberately the same shape: a
 * loader that reads a whole basket's worth of composition in one query, and a pure check returning
 * the problem rather than throwing it - the cart refuses an add on one, and reports the same
 * finding on a line it already holds as a pricing issue, each caller wording its own message.
 *
 * What it enforces is `product.md` §8.1, which no constraint can reach because the picks live in
 * `cart_item` rows rather than in the catalog:
 *
 * - every pick is a component of the line's own bundle
 * - a component that is always included is not something to pick; it comes with the kit
 * - every group receives **exactly one** candidate, that being the whole of what a group means
 * - a tick box is taken within its own `quantity` ceiling
 *
 * `quantity` on `product_bundle_item` is `numeric` with no transformer, so it arrives from the
 * driver as a string. Every read of it here goes through `Number()`; dropping that leaves the
 * ceiling comparison doing a string comparison and the unit arithmetic concatenating.
 */
export class ProductBundleSelectionService {
	/**
	 * The composition of every bundle named, in catalog order, keyed by product. One read for the
	 * components and one for the groups, whatever the basket holds.
	 *
	 * Soft-deleted rows are dropped here rather than filtered by the callers: a withdrawn
	 * component is not on offer, and a line still naming one is reported against the live
	 * composition by `findProblem`.
	 */
	public async loadComposition(
		productIds: readonly number[],
	): Promise<Map<number, LoadedComposition>> {
		const byProduct = new Map<number, LoadedComposition>();

		if (productIds.length === 0) {
			return byProduct;
		}

		const ids = [...new Set(productIds)];

		const [items, groups] = await Promise.all([
			dataSource.getRepository(ProductBundleItemEntity).find({
				where: { product_id: In(ids) },
				order: { position: 'ASC', id: 'ASC' },
			}),
			dataSource.getRepository(ProductBundleGroupEntity).find({
				where: { product_id: In(ids) },
				order: { position: 'ASC', id: 'ASC' },
			}),
		]);

		const groupOwner = new Map(
			groups.map((group) => [group.id, group.product_id]),
		);

		for (const productId of ids) {
			byProduct.set(productId, {
				mandatory: [],
				optional: [],
				candidatesByGroup: new Map(),
				byId: new Map(),
			});
		}

		// Every group gets an entry even with no candidates, so `findProblem` can refuse a bundle
		// whose group was emptied rather than answer that nothing was left unanswered.
		for (const group of groups) {
			byProduct
				.get(group.product_id)
				?.candidatesByGroup.set(group.id, []);
		}

		for (const item of items) {
			const composition = byProduct.get(item.product_id);

			if (!composition) {
				continue;
			}

			composition.byId.set(item.id, item);

			if (item.group_id === null) {
				if (item.is_optional) {
					composition.optional.push(item);
				} else {
					composition.mandatory.push(item);
				}

				continue;
			}

			/*
			 * A candidate whose group belongs to another product is a catalog fault rather than a
			 * shopper's, and it is dropped instead of crashing the read - the bundle then reads as
			 * one candidate short, which `assertBundleGroupsAreUsable` is what refuses on write.
			 */
			if (groupOwner.get(item.group_id) !== item.product_id) {
				continue;
			}

			composition.candidatesByGroup.get(item.group_id)?.push(item);
		}

		return byProduct;
	}

	/**
	 * `null` when the picks answer the bundle exactly. A repeated `item_id` is the same pick sent
	 * twice and is folded before anything is counted, so it cannot smuggle a second unit past the
	 * ceiling or read as two answers to one group.
	 */
	public static findProblem(
		composition: LoadedComposition,
		chosen: readonly BundleChoice[],
	): BundleSelectionProblem | null {
		const units = new Map<number, number>();

		for (const choice of chosen) {
			units.set(choice.item_id, choice.units ?? 1);
		}

		for (const [itemId, taken] of units) {
			const item = composition.byId.get(itemId);

			if (!item) {
				return { reason: 'foreign_component' };
			}

			// Case 1 comes with the kit. Naming it would let a caller take a second helping of
			// something the bundle price already covers.
			if (item.group_id === null && !item.is_optional) {
				return { reason: 'included_component', item_id: itemId };
			}

			if (item.group_id === null) {
				const ceiling = Number(item.quantity);

				if (taken < 1 || taken > ceiling) {
					return {
						reason: 'over_ceiling',
						item_id: itemId,
						max: ceiling,
					};
				}
			}
		}

		for (const [groupId, candidates] of composition.candidatesByGroup) {
			const answered = candidates.filter((candidate) =>
				units.has(candidate.id),
			).length;

			if (answered === 0) {
				return { reason: 'group_unanswered', group_id: groupId };
			}

			if (answered > 1) {
				return { reason: 'group_multiple', group_id: groupId };
			}
		}

		return null;
	}

	/**
	 * What the bundle actually contains once the picks are applied: the kit, plus the tick boxes
	 * ticked, plus the candidate chosen in each group. In catalog order, so a cart writes its
	 * component rows the way the bundle reads.
	 *
	 * Call it only on a selection `findProblem` has passed - it trusts the picks and silently
	 * ignores one naming nothing.
	 */
	public static resolve(
		composition: LoadedComposition,
		chosen: readonly BundleChoice[],
	): ResolvedComponent[] {
		const units = new Map<number, number>();

		for (const choice of chosen) {
			units.set(choice.item_id, choice.units ?? 1);
		}

		const resolved: ResolvedComponent[] = composition.mandatory.map(
			(item) => ({
				item: item,
				units: Number(item.quantity),
				included: true,
			}),
		);

		for (const item of composition.optional) {
			const taken = units.get(item.id);

			if (taken !== undefined) {
				resolved.push({ item: item, units: taken, included: false });
			}
		}

		for (const candidates of composition.candidatesByGroup.values()) {
			for (const item of candidates) {
				if (units.has(item.id)) {
					// A candidate's own `quantity` is what the bundle contains once it is the one
					// chosen - the group decides which, never how many.
					resolved.push({
						item: item,
						units: Number(item.quantity),
						included: false,
					});
				}
			}
		}

		return resolved;
	}
}

export const productBundleSelectionService =
	new ProductBundleSelectionService();
