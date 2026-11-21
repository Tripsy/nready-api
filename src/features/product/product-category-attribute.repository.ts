import { type EntityManager, In, type Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ProductCategoryAttributeEntity from '@/features/product/product-category-attribute.entity';
import type { ProductCategoryAttributeOptionType } from '@/features/product/product-category-attribute.validator';
import ProductCategoryAttributeOptionEntity from '@/features/product/product-category-attribute-option.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * A definition and the depth of the category it came from, which is what decides an override.
 *
 * Depth is the ancestor count of the owning category - a root is 0 - read from the closure table
 * rather than walked in the application: the resolution set spans every ancestor of every category
 * a product sits in, and one query answers for all of them.
 */
export type DefinitionWithDepth = {
	definition: ProductCategoryAttributeEntity;
	depth: number;
};

export class ProductCategoryAttributeQuery extends RepositoryAbstract<ProductCategoryAttributeEntity> {
	constructor(repository: Repository<ProductCategoryAttributeEntity>) {
		super(repository, ProductCategoryAttributeEntity.NAME);
	}
}

export const ProductCategoryAttributeRepository = dataSource
	.getRepository(ProductCategoryAttributeEntity)
	.extend({
		createQuery() {
			return new ProductCategoryAttributeQuery(this);
		},

		/**
		 * Every definition that applies to a set of categories, with the depth of the category
		 * that declared it.
		 *
		 * Two steps rather than one join, because the two questions are different shapes: which
		 * categories are in scope is a closure-table walk that answers with ids, and what they
		 * declare is an ordinary read of this table. Folding them together would need an
		 * aggregate over the closure alongside the joined option rows, and the raw result would
		 * have to be reassembled into entities anyway.
		 *
		 * The walk keeps a definition on an ancestor only while its `inherit` is true; a
		 * category's own definitions apply regardless, which is the `id_ancestor = id_descendant`
		 * row the closure table stores for every node. Ordering and the deepest-wins dedupe
		 * happen in the service, since both are about the resolved set rather than any one row.
		 */
		async findForCategories(
			categoryIds: EntityId[],
		): Promise<DefinitionWithDepth[]> {
			if (categoryIds.length === 0) {
				return [];
			}

			const ancestry: { category_id: EntityId; depth: string }[] =
				await dataSource.query(
					`SELECT DISTINCT closure.id_ancestor AS category_id,
						(
							SELECT COUNT(*) - 1
							FROM category_closure own
							WHERE own.id_descendant = closure.id_ancestor
						) AS depth
					FROM category_closure closure
					WHERE closure.id_descendant = ANY($1)`,
					[categoryIds],
				);

			const depthById = new Map(
				ancestry.map((row) => [row.category_id, Number(row.depth)]),
			);

			if (depthById.size === 0) {
				return [];
			}

			/*
			 * The wording comes with them. This set *is* the form a product renders - the label
			 * names the field and the options are the choices in it - so the ids alone would
			 * leave the caller with a control it cannot draw, and no way to resolve them but one
			 * request per row.
			 */
			const definitions = await this.find({
				where: { category_id: In([...depthById.keys()]) },
				relations: {
					attribute_label: { contents: true },
					options: { term: { contents: true } },
				},
				order: { sort_order: 'ASC' },
			});

			const own = new Set(categoryIds);

			return definitions
				.filter(
					(definition) =>
						own.has(definition.category_id) || definition.inherit,
				)
				.map((definition) => {
					definition.options?.sort(
						(left, right) => left.sort_order - right.sort_order,
					);

					return {
						definition,
						depth: depthById.get(definition.category_id) ?? 0,
					};
				});
		},

		/**
		 * The admissible values of a list-backed definition, in offer order.
		 *
		 * Replaced wholesale on a save, keyed on the term: the option *is* its term, so two
		 * rows naming the same one are the same option offered twice.
		 */
		async syncOptions(
			manager: EntityManager,
			attribute_id: EntityId,
			options: ProductCategoryAttributeOptionType[],
		): Promise<void> {
			const repository = manager.getRepository(
				ProductCategoryAttributeOptionEntity,
			);

			const existing = await repository.find({
				where: { attribute_id },
				withDeleted: true,
			});

			const wanted = new Map(
				options.map((option) => [option.term_id, option]),
			);
			const known = new Map(existing.map((row) => [row.term_id, row]));

			const toRemove = existing.filter(
				(row) => row.deleted_at === null && !wanted.has(row.term_id),
			);

			if (toRemove.length > 0) {
				await repository.softRemove(toRemove);
			}

			const toSave: ProductCategoryAttributeOptionEntity[] = [];

			for (const [term_id, option] of wanted) {
				const row =
					known.get(term_id) ??
					repository.create({ attribute_id, term_id });

				row.deleted_at = null;
				row.sort_order = option.sort_order ?? 0;

				toSave.push(row);
			}

			if (toSave.length > 0) {
				await repository.save(toSave);
			}
		},
	});

export default ProductCategoryAttributeRepository;
