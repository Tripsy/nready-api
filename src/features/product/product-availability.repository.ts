import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type { ProductAvailabilityType } from '@/features/product/product.validator';
import ProductAvailabilityEntity from '@/features/product/product-availability.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Postgres hands a `time` column back as `HH:MM:SS` while the validator produces `HH:MM`, so the
 * two spellings of one clock time would never match when a window is re-stated. Both sides pass
 * through here before they are compared or stored.
 *
 * Null passes through: an all-day window has no hours, and the two columns are null together.
 */
const normalizeTime = (value: string | null | undefined): string | null => {
	if (!value) {
		return null;
	}

	return value.length === 5 ? `${value}:00` : value;
};

/**
 * A window has no identifier of its own - what it *is* is the weekday and the two clock times,
 * so that is the key a re-save matches on. Anything the payload no longer states is removed.
 */
const windowKey = (row: {
	day_of_week: number | null;
	starts_at: string | null;
	ends_at: string | null;
}): string =>
	[
		row.day_of_week ?? 'every-day',
		normalizeTime(row.starts_at) ?? 'all-day',
		normalizeTime(row.ends_at) ?? 'all-day',
	].join('|');

export class ProductAvailabilityQuery extends RepositoryAbstract<ProductAvailabilityEntity> {
	constructor(repository: Repository<ProductAvailabilityEntity>) {
		super(repository, ProductAvailabilityEntity.NAME);
	}
}

export const ProductAvailabilityRepository = dataSource
	.getRepository(ProductAvailabilityEntity)
	.extend({
		createQuery() {
			return new ProductAvailabilityQuery(this);
		},

		/**
		 * Replaces the product's recurring windows.
		 *
		 * An empty list is the meaningful common case rather than a no-op: no row at all means
		 * unrestricted, so clearing the windows is how a product goes back to being orderable
		 * at any hour.
		 */
		async syncWindows(
			manager: EntityManager,
			product_id: EntityId,
			windows: ProductAvailabilityType[],
		): Promise<void> {
			const repository = manager.getRepository(ProductAvailabilityEntity);

			const existing = await repository.find({ where: { product_id } });

			const wanted = new Map(
				windows.map((window) => {
					const row = {
						day_of_week: window.day_of_week ?? null,
						starts_at: normalizeTime(window.starts_at),
						ends_at: normalizeTime(window.ends_at),
					};

					return [windowKey(row), row];
				}),
			);

			const toRemove = existing.filter(
				(row) => !wanted.has(windowKey(row)),
			);

			for (const row of existing) {
				wanted.delete(windowKey(row));
			}

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			if (wanted.size > 0) {
				await repository.save(
					Array.from(wanted.values(), (row) =>
						repository.create({ product_id, ...row }),
					),
				);
			}
		},
	});

export default ProductAvailabilityRepository;
