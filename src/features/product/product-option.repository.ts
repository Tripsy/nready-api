import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type {
	ProductOptionGroupType,
	ProductPriceDeltaType,
} from '@/features/product/product.validator';
import ProductOptionEntity from '@/features/product/product-option.entity';
import ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import ProductOptionPriceEntity from '@/features/product/product-option-price.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ProductOptionGroupQuery extends RepositoryAbstract<ProductOptionGroupEntity> {
	constructor(repository: Repository<ProductOptionGroupEntity>) {
		super(repository, ProductOptionGroupEntity.NAME);
	}
}

/**
 * Groups, their answers and the per-currency deltas are one aggregate: a group is the question
 * and the options are what it means, so neither is saved without the other.
 *
 * The label term is the natural key on both levels. Nothing in the schema forbids a product
 * asking the same question twice, but a payload that did could not be told apart from an edit of
 * the first - and a form showing "Crust" twice is a defect either way.
 */
export const ProductOptionRepository = dataSource
	.getRepository(ProductOptionGroupEntity)
	.extend({
		createQuery() {
			return new ProductOptionGroupQuery(this);
		},

		async syncGroups(
			manager: EntityManager,
			product_id: number,
			groups: ProductOptionGroupType[],
		): Promise<void> {
			const repository = manager.getRepository(ProductOptionGroupEntity);

			const existing = await repository.find({
				where: { product_id },
			});

			const wanted = new Map(
				groups.map((group) => [group.label_id, group]),
			);
			const known = new Map(existing.map((row) => [row.label_id, row]));

			const toRemove = existing.filter(
				(row) => !wanted.has(row.label_id),
			);

			// Hard: no level of this aggregate carries `deleted_at`. A group dropped from the form
			// takes its answers and their deltas with it through the `option_group_id` cascade
			if (toRemove.length > 0) {
				await repository.remove(toRemove);
			}

			for (const [label_id, group] of wanted) {
				const row =
					known.get(label_id) ??
					repository.create({ product_id, label_id });

				row.min_select = group.min_select ?? 0;
				row.max_select = group.max_select ?? null;
				row.position = group.position ?? 0;

				const saved = await repository.save(row);

				await this.syncOptions(manager, saved.id, group.options);
			}
		},

		async syncOptions(
			manager: EntityManager,
			option_group_id: number,
			options: ProductOptionGroupType['options'],
		): Promise<void> {
			const repository = manager.getRepository(ProductOptionEntity);

			const existing = await repository.find({
				where: { option_group_id },
			});

			const wanted = new Map(
				options.map((option) => [option.label_id, option]),
			);
			const known = new Map(existing.map((row) => [row.label_id, row]));

			const toRemove = existing.filter(
				(row) => !wanted.has(row.label_id),
			);

			// Cleared ahead of the writes for the same reason as the default variant: the
			// partial unique index allows one preselected answer per group, and setting the
			// new one before clearing the old collides with it
			if (existing.length > 0) {
				await repository.update(
					{ option_group_id, is_default: true },
					{ is_default: false },
				);
			}

			/*
			 * Hard: no level of this aggregate carries `deleted_at`. An answer dropped from the
			 * form is gone, so re-adding the same label mints a new row with a new id - and the
			 * ids already written into `order_line.options[].option_id` and `cart_item.options`
			 * carry no foreign key, so they point at nothing from here on. The delta rows follow
			 * through the `product_option_price.option_id` cascade.
			 */
			if (toRemove.length > 0) {
				await repository.remove(toRemove);
			}

			for (const [label_id, option] of wanted) {
				const row =
					known.get(label_id) ??
					repository.create({ option_group_id, label_id });

				row.position = option.position ?? 0;
				row.is_default = option.is_default ?? false;

				const saved = await repository.save(row);

				await this.syncPrices(manager, saved.id, option.prices);
			}
		},

		/** One delta per currency, keyed the way the table's unique index is. */
		async syncPrices(
			manager: EntityManager,
			option_id: number,
			prices: ProductPriceDeltaType[],
		): Promise<void> {
			const repository = manager.getRepository(ProductOptionPriceEntity);

			const existing = await repository.find({
				where: { option_id },
			});

			const wanted = new Map(
				prices.map((price) => [price.currency, price]),
			);
			const known = new Map(existing.map((row) => [row.currency, row]));

			const toRemove = existing.filter(
				(row) => !wanted.has(row.currency),
			);

			// Hard, like the two levels above: a currency dropped from the form is gone, and the
			// unconditional unique index means there is no soft-deleted row left to collide with
			if (toRemove.length > 0) {
				await repository.remove(toRemove);
			}

			const toSave: ProductOptionPriceEntity[] = [];

			for (const [currency, price] of wanted) {
				const row =
					known.get(currency) ??
					repository.create({ option_id, currency });

				row.price_delta = price.price_delta;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},
	});

export default ProductOptionRepository;
