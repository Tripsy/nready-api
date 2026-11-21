import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type {
	ProductBundleGroupType,
	ProductBundleItemType,
	ProductPriceDeltaType,
} from '@/features/product/product.validator';
import ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import ProductBundleItemPriceEntity from '@/features/product/product-bundle-item-price.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ProductBundleItemQuery extends RepositoryAbstract<ProductBundleItemEntity> {
	constructor(repository: Repository<ProductBundleItemEntity>) {
		super(repository, ProductBundleItemEntity.NAME);
	}
}

/**
 * A component with its group resolved to a row id: the payload names the group by label, and only
 * the service can turn that into the id the column holds. `null` is a component outside any group,
 * which is most of them.
 */
export type ResolvedBundleItem = ProductBundleItemType & {
	group_id: EntityId | null;
};

/**
 * The composition side, and the closest thing in this feature to `product-option.repository.ts`:
 * groups, their candidates and the per-currency deltas are one aggregate. What differs is what a
 * choice is made of - an item names a `product_variant`, a real sellable thing that consumes stock
 * and carries its own VAT class, where an option names a term.
 *
 * Components are kept flat rather than nested under their group, unlike options: a bundle holds
 * components that belong to no group at all, and one list that some rows carry a `group_id` in
 * beats two lists a component could be read from. So the two syncs are separate, and the group's
 * runs first - an item cannot name a row that has not been written.
 *
 * The variant is the natural key of an item and the label term that of a group, so a component
 * that moved into or out of a group keeps its id, and the deltas hanging off it.
 */
export const ProductBundleRepository = dataSource
	.getRepository(ProductBundleItemEntity)
	.extend({
		createQuery() {
			return new ProductBundleItemQuery(this);
		},

		/**
		 * The choices one bundle offers, matched by label term.
		 *
		 * A group that goes away is soft-removed, which leaves its candidates pointing at it -
		 * a soft delete cascades nowhere. `assertBundleGroupsAreUsable` is what catches that,
		 * by reading the pair back rather than trusting either sync.
		 */
		async syncGroups(
			manager: EntityManager,
			product_id: EntityId,
			groups: ProductBundleGroupType[],
		): Promise<void> {
			const repository = manager.getRepository(ProductBundleGroupEntity);

			const existing = await repository.find({
				where: { product_id },
				withDeleted: true,
			});

			const wanted = new Map(
				groups.map((group) => [group.label_id, group]),
			);
			const known = new Map(existing.map((row) => [row.label_id, row]));

			const toRemove = existing.filter(
				(row) => row.deleted_at === null && !wanted.has(row.label_id),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			const toSave: ProductBundleGroupEntity[] = [];

			for (const [label_id, group] of wanted) {
				const row =
					known.get(label_id) ??
					repository.create({ product_id, label_id });

				row.deleted_at = null;
				row.position = group.position ?? 0;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},

		/**
		 * The components of one bundle, groups and all. Rows are matched by variant, so a
		 * component whose quantity, position or group changed is updated rather than replaced -
		 * which keeps the id an order line may already reference, and the deltas hanging off it.
		 *
		 * Saved one at a time rather than in a batch, because each row's id is what its deltas
		 * are keyed by and a new component has none until it is written.
		 */
		async syncItems(
			manager: EntityManager,
			product_id: EntityId,
			items: ResolvedBundleItem[],
		): Promise<void> {
			const repository = manager.getRepository(ProductBundleItemEntity);

			const existing = await repository.find({
				where: { product_id },
				withDeleted: true,
			});

			const wanted = new Map(
				items.map((item) => [item.variant_id, item]),
			);
			const known = new Map(existing.map((row) => [row.variant_id, row]));

			// Cleared ahead of the writes for the same reason as the default variant and the
			// preselected option: the partial unique index allows one preselected candidate per
			// group, and setting the new one before clearing the old collides with it
			if (existing.length > 0) {
				await repository.update(
					{ product_id, is_default: true },
					{ is_default: false },
				);
			}

			const toRemove = existing.filter(
				(row) => row.deleted_at === null && !wanted.has(row.variant_id),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			for (const [variant_id, item] of wanted) {
				const row =
					known.get(variant_id) ??
					repository.create({ product_id, variant_id });

				row.deleted_at = null;
				row.quantity = item.quantity ?? 1;
				row.position = item.position ?? 0;
				row.group_id = item.group_id;
				row.is_optional = item.is_optional;
				row.is_default = item.is_default;

				const saved = await repository.save(row);

				await this.syncPrices(manager, saved.id, item.prices);
			}
		},

		/**
		 * One delta per currency, keyed the way the table's unique index is.
		 *
		 * A component the customer does not choose carries none - the validator refuses a delta
		 * there - so this also clears whatever a row kept from before it was made mandatory
		 * again, or lifted out of a group.
		 */
		async syncPrices(
			manager: EntityManager,
			item_id: EntityId,
			prices: ProductPriceDeltaType[],
		): Promise<void> {
			const repository = manager.getRepository(
				ProductBundleItemPriceEntity,
			);

			const existing = await repository.find({
				where: { item_id },
				withDeleted: true,
			});

			const wanted = new Map(
				prices.map((price) => [price.currency, price]),
			);
			const known = new Map(existing.map((row) => [row.currency, row]));

			const toRemove = existing.filter(
				(row) => row.deleted_at === null && !wanted.has(row.currency),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			const toSave: ProductBundleItemPriceEntity[] = [];

			for (const [currency, price] of wanted) {
				const row =
					known.get(currency) ??
					repository.create({ item_id, currency });

				row.deleted_at = null;
				row.price_delta = price.price_delta;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},
	});

export default ProductBundleRepository;
