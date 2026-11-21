import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type { ProductAttributeType } from '@/features/product/product.validator';
import ProductAttributeEntity from '@/features/product/product-attribute.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * A payload value with its normalized form attached. `value_base` never comes from a request -
 * `ProductService` looks the label's definition up, applies `toBaseUnit`, and hands the row
 * over already carrying the figure a range filter compares.
 */
export type ResolvedAttributeValue = ProductAttributeType & {
	value_base: number | null;
};

/**
 * The key a row is matched on when a payload replaces the set.
 *
 * It mirrors the table's two partial unique indexes rather than the label alone: a product may
 * carry three allergens under one label, so a term-backed row is identified by its value, while
 * a scalar one is identified by the label - a product has exactly one volume.
 */
export const attributeKey = (value: {
	attribute_label_id: EntityId;
	value_term_id?: EntityId | null;
}): string =>
	value.value_term_id
		? `${value.attribute_label_id}:term:${value.value_term_id}`
		: `${value.attribute_label_id}:scalar`;

export class ProductAttributeQuery extends RepositoryAbstract<ProductAttributeEntity> {
	constructor(repository: Repository<ProductAttributeEntity>) {
		super(repository, ProductAttributeEntity.NAME);
	}
}

export const ProductAttributeRepository = dataSource
	.getRepository(ProductAttributeEntity)
	.extend({
		createQuery() {
			return new ProductAttributeQuery(this);
		},

		/**
		 * Replaces the product's attribute set with the one the payload states.
		 *
		 * Soft-deleted rows are read alongside the live ones because the unique indexes are
		 * partial: a row removed in an earlier edit still occupies its key until it is
		 * restored, so re-stating a value has to revive that row rather than insert a second.
		 */
		async syncValues(
			manager: EntityManager,
			product_id: EntityId,
			values: ResolvedAttributeValue[],
		): Promise<void> {
			const repository = manager.getRepository(ProductAttributeEntity);

			const existing = await repository.find({
				where: { product_id },
				withDeleted: true,
			});

			const wanted = new Map(
				values.map((value) => [attributeKey(value), value]),
			);
			const known = new Map(
				existing.map((row) => [attributeKey(row), row]),
			);

			const toRemove = existing.filter(
				(row) =>
					row.deleted_at === null && !wanted.has(attributeKey(row)),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			const toSave: ProductAttributeEntity[] = [];

			for (const [key, value] of wanted) {
				const row = known.get(key) ?? repository.create({ product_id });

				row.deleted_at = null;
				row.attribute_label_id = value.attribute_label_id;
				row.value_term_id = value.value_term_id ?? null;
				row.value_numeric = value.value_numeric ?? null;
				row.value_base = value.value_base;
				row.value_text = value.value_text ?? null;
				row.value_boolean = value.value_boolean ?? null;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},
	});

export default ProductAttributeRepository;
