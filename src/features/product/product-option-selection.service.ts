import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import ProductOptionEntity from '@/features/product/product-option.entity';
import ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import TermContentEntity from '@/features/term/term-content.entity';

/** A group read with its live answers - `options` is loaded, where the entity leaves it optional. */
export type LoadedOptionGroup = ProductOptionGroupEntity & {
	options: ProductOptionEntity[];
};

/** Why a set of chosen answers cannot stand against the product's questions. */
export type OptionSelectionProblem =
	| { reason: 'foreign_option' }
	| { reason: 'selection'; min: number; max: number | null };

/**
 * The two option invariants `product.md` §10 leaves to the service layer, held in one place for
 * every writer of a line - a cart adding an item, an order composed or edited in the back office.
 * `options` is jsonb on both `cart_item` and `order_line`, so no constraint can reach either:
 *
 * - every chosen answer belongs to a group of the line's own product (§10.2)
 * - every group of that product receives between `min_select` and `max_select` answers (§10.3)
 *
 * The problem is returned rather than thrown: the cart refuses an add, but reports the same finding
 * on a line it already holds as a pricing issue, and each caller words its own message.
 */
export class ProductOptionSelectionService {
	/**
	 * Every group of every product named, with its live answers, keyed by product and in catalog
	 * order. All of a product's groups rather than the ones the chosen answers sit in: a required
	 * question nobody answered has to be seen to be refused. One read for the whole set.
	 */
	public async loadGroups(
		productIds: readonly number[],
	): Promise<Map<number, LoadedOptionGroup[]>> {
		const byProduct = new Map<number, LoadedOptionGroup[]>();

		if (productIds.length === 0) {
			return byProduct;
		}

		const groups = await dataSource
			.getRepository(ProductOptionGroupEntity)
			.find({
				where: { product_id: In([...new Set(productIds)]) },
				relations: { options: true },
				order: {
					position: 'ASC',
					id: 'ASC',
					options: { position: 'ASC' },
				},
			});

		for (const group of groups) {
			const loaded: LoadedOptionGroup = Object.assign(group, {
				options: group.options ?? [],
			});

			const list = byProduct.get(group.product_id) ?? [];

			list.push(loaded);
			byProduct.set(group.product_id, list);
		}

		return byProduct;
	}

	/**
	 * The wording each answer carries, keyed by **option id**, in the deployment's default content
	 * language - so a document reads the same whichever operator's dashboard language it was saved
	 * from.
	 *
	 * Option labels are `term` rows, and `term` is the catalog's dependency rather than its
	 * readers': a line writer asks here instead of joining `term_content` itself. The key is the
	 * option rather than the term because the caller holds option ids - `label_id` is an internal
	 * detail of how the wording is stored.
	 *
	 * An option whose label has no content row in that language is absent from the map; the caller
	 * decides what to write in its place.
	 */
	public async loadLabels(
		optionIds: readonly number[],
	): Promise<Map<number, string>> {
		const labels = new Map<number, string>();
		const ids = [...new Set(optionIds)];

		if (ids.length === 0) {
			return labels;
		}

		const rows = await dataSource
			.getRepository(ProductOptionEntity)
			.createQueryBuilder('option')
			.innerJoin(
				TermContentEntity,
				'content',
				'content.term_id = option.label_id',
			)
			.where('option.id IN (:...ids)', { ids: ids })
			.andWhere('content.language = :language', {
				language: Configuration.language(),
			})
			.select(['option.id AS option_id', 'content.value AS value'])
			.getRawMany<{ option_id: number; value: string }>();

		for (const row of rows) {
			labels.set(Number(row.option_id), row.value);
		}

		return labels;
	}

	/**
	 * `null` when the chosen answers fit the product's questions. A repeated id is the same answer
	 * sent twice and counts once. An id no live group of the product offers - another product's
	 * answer, or one since withdrawn - is a `foreign_option`.
	 */
	public static findProblem(
		groups: readonly LoadedOptionGroup[],
		chosen: readonly number[],
	): OptionSelectionProblem | null {
		const picked = new Set(chosen);

		const offered = new Set(
			groups.flatMap((group) => group.options.map((option) => option.id)),
		);

		for (const optionId of picked) {
			if (!offered.has(optionId)) {
				return { reason: 'foreign_option' };
			}
		}

		for (const group of groups) {
			const answered = group.options.filter((option) =>
				picked.has(option.id),
			).length;

			if (
				answered < group.min_select ||
				(group.max_select !== null && answered > group.max_select)
			) {
				return {
					reason: 'selection',
					min: group.min_select,
					max: group.max_select,
				};
			}
		}

		return null;
	}
}

export const productOptionSelectionService =
	new ProductOptionSelectionService();
