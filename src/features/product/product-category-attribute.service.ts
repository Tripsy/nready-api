import {
	type DeepPartial,
	type EntityManager,
	In,
	QueryFailedError,
} from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import CategoryContentEntity from '@/features/category/category-content.entity';
import ProductAttributeEntity from '@/features/product/product-attribute.entity';
import ProductCategoryAttributeEntity, {
	type ProductCategoryAttributeScope,
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import ProductCategoryAttributeRepository, {
	type DefinitionWithDepth,
} from '@/features/product/product-category-attribute.repository';
import type { ProductCategoryAttributeValidator } from '@/features/product/product-category-attribute.validator';
import ProductVariantAttributeEntity from '@/features/product/product-variant-attribute.entity';
import { compareIds } from '@/helpers/id.helper';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import { type MeasureUnit, toBaseUnit } from '@/shared/types/measure-unit.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * How an attribute label reads in a message meant for an editor.
 *
 * A label is a term, and a term is stored as it was typed - `color`, not `Color`. The dashboard
 * capitalizes one for display wherever it renders it, so a message that named it verbatim would
 * be the one place the same label appeared lower-cased. The id fallback is left alone: `#8` is
 * not a word.
 */
export function attributeLabelName(
	definition: Pick<
		ProductCategoryAttributeEntity,
		'attribute_label' | 'attribute_label_id'
	>,
): string {
	const value = definition.attribute_label?.contents?.[0]?.value;

	if (!value) {
		return `#${definition.attribute_label_id}`;
	}

	return value.charAt(0).toUpperCase() + value.slice(1);
}

const DEFINITION_UNIQUE_INDEX = 'IDX_product_category_attribute_unique';

/** How far apart a reorder places consecutive definitions, leaving room to slip one between. */
const SORT_ORDER_STEP = 10;

/** Columns owned by the definition row itself; `options` live in their own table. */
const entryColumns: string[] = [
	'scope',
	'value_type',
	'type',
	'unit',
	'prefix',
	'suffix',
	'min_value',
	'max_value',
	'is_required',
	'is_filterable',
	'inherit',
	'sort_order',
];

/**
 * The nullable ones among them - the only columns a caller can empty rather than change.
 * The rest are `NOT NULL` with a default, so there is nothing for a `null` to mean there.
 */
const nullableEntryColumns: string[] = [
	'unit',
	'prefix',
	'suffix',
	'min_value',
	'max_value',
];

/** The resolved form, split the way the product editor renders it. */
export type ResolvedAttributeForm = {
	[ProductCategoryAttributeScopeEnum.PRODUCT]: ProductCategoryAttributeEntity[];
	[ProductCategoryAttributeScopeEnum.VARIANT]: ProductCategoryAttributeEntity[];
};

export class ProductCategoryAttributeService {
	constructor(
		private repository: typeof ProductCategoryAttributeRepository,
	) {}

	/**
	 * The `(category_id, attribute_label_id)` unique index answered as a 409 rather than the
	 * masked 500 a bare unique violation becomes. Matched by name, since the table will grow
	 * other uniques whose violation means something else.
	 */
	private asConflict(error: unknown): unknown {
		if (!RepositoryAbstract.isUniqueViolation(error)) {
			return error;
		}

		const constraint =
			error instanceof QueryFailedError
				? (error.driverError?.constraint as string | undefined)
				: undefined;

		if (constraint !== DEFINITION_UNIQUE_INDEX) {
			return error;
		}

		return new CustomError(
			409,
			lang('product.error.attribute_already_defined'),
		);
	}

	/**
	 * The rules the row has to satisfy once the payload is merged onto it.
	 *
	 * The validator runs the same checks against a `create` payload, where every field is
	 * stated. An update carries only what changed, so this is the pass that actually holds -
	 * moving a definition from `term` to `number` while leaving its option rows in place is a
	 * two-field change no single-field check can see.
	 */
	private assertDefinition(
		entry: ProductCategoryAttributeEntity,
		optionCount: number,
	): void {
		const isTerm =
			entry.value_type === ProductCategoryAttributeValueTypeEnum.TERM;
		const isNumber =
			entry.value_type === ProductCategoryAttributeValueTypeEnum.NUMBER;

		const admissible: Record<string, readonly string[]> = {
			[ProductCategoryAttributeTypeEnum.INPUT]: [
				ProductCategoryAttributeValueTypeEnum.NUMBER,
				ProductCategoryAttributeValueTypeEnum.STRING,
				ProductCategoryAttributeValueTypeEnum.BOOLEAN,
			],
			[ProductCategoryAttributeTypeEnum.SELECT]: [
				ProductCategoryAttributeValueTypeEnum.TERM,
			],
			[ProductCategoryAttributeTypeEnum.RADIO]: [
				ProductCategoryAttributeValueTypeEnum.TERM,
			],
			[ProductCategoryAttributeTypeEnum.CHECKBOX]: [
				ProductCategoryAttributeValueTypeEnum.TERM,
				ProductCategoryAttributeValueTypeEnum.BOOLEAN,
			],
		};

		if (!admissible[entry.type]?.includes(entry.value_type)) {
			throw new CustomError(
				422,
				lang('product.validation.type_value_type_mismatch'),
			);
		}

		if (entry.unit && !isNumber) {
			throw new CustomError(
				422,
				lang('product.validation.unit_requires_number'),
			);
		}

		if (entry.unit && entry.suffix) {
			throw new CustomError(
				422,
				lang('product.validation.unit_excludes_suffix'),
			);
		}

		if (
			(entry.min_value !== null || entry.max_value !== null) &&
			!isNumber
		) {
			throw new CustomError(
				422,
				lang('product.validation.bounds_require_number'),
			);
		}

		if (
			entry.min_value !== null &&
			entry.max_value !== null &&
			entry.min_value > entry.max_value
		) {
			throw new CustomError(
				422,
				lang('product.validation.max_below_min'),
			);
		}

		// The half no row-level check can make: the admissible values live in another table,
		// and a list with nothing in it is a control a product can never satisfy
		if (isTerm && optionCount === 0) {
			throw new CustomError(
				422,
				lang('product.validation.options_required'),
			);
		}

		if (!isTerm && optionCount > 0) {
			throw new CustomError(
				422,
				lang('product.validation.options_require_term'),
			);
		}
	}

	public async create(
		data: ValidatorOutput<ProductCategoryAttributeValidator, 'create'>,
	): Promise<ProductCategoryAttributeEntity> {
		try {
			return await dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(
					ProductCategoryAttributeEntity,
				);

				/*
				 * The column defaults are restated rather than left to the database, because
				 * `assertDefinition` runs before the insert and has to see the row as it will
				 * be stored - an absent `value_type` reaching it as `undefined` fails every
				 * rule it checks, including the ones the payload satisfies.
				 */
				const entry = repository.create({
					category_id: data.category_id,
					attribute_label_id: data.attribute_label_id,
					scope:
						data.scope ?? ProductCategoryAttributeScopeEnum.PRODUCT,
					value_type:
						data.value_type ??
						ProductCategoryAttributeValueTypeEnum.TERM,
					type: data.type ?? ProductCategoryAttributeTypeEnum.SELECT,
					unit: data.unit ?? null,
					prefix: data.prefix ?? null,
					suffix: data.suffix ?? null,
					min_value: data.min_value ?? null,
					max_value: data.max_value ?? null,
					is_required: data.is_required ?? false,
					is_filterable: data.is_filterable ?? false,
					inherit: data.inherit ?? true,
					sort_order: data.sort_order ?? 0,
				});

				this.assertDefinition(entry, data.options?.length ?? 0);

				const saved = await repository.save(entry);

				await this.repository.syncOptions(
					manager,
					saved.id,
					data.options ?? [],
				);

				return saved;
			});
		} catch (error) {
			throw this.asConflict(error);
		}
	}

	/**
	 * A definition's `unit` is applied on write, so changing it does not reinterpret the values
	 * already recorded under it - every one has to be rewritten through the new factor, or the
	 * stored base figures describe a quantity the form no longer shows.
	 *
	 * Scoped to the products in this definition's category subtree rather than to the label: the
	 * same label is legitimately quoted in `ml` under Drinks and in `l` under Bulk, and rewriting
	 * every row carrying it would corrupt the other category's catalog to fix this one.
	 */
	private async rewriteBaseValues(
		manager: EntityManager,
		entry: ProductCategoryAttributeEntity,
	): Promise<number> {
		const productRows: { product_id: EntityId }[] = await manager.query(
			`SELECT DISTINCT link.product_id
			FROM product_category link
			JOIN category_closure closure ON closure.id_descendant = link.category_id
			WHERE closure.id_ancestor = $1 AND link.deleted_at IS NULL`,
			[entry.category_id],
		);

		const productIds = productRows.map((row) => row.product_id);

		if (productIds.length === 0) {
			return 0;
		}

		if (entry.scope === ProductCategoryAttributeScopeEnum.VARIANT) {
			const rows = await manager
				.getRepository(ProductVariantAttributeEntity)
				.createQueryBuilder('value')
				.innerJoin(
					'product_variant',
					'variant',
					'variant.id = value.variant_id',
				)
				.where('value.attribute_label_id = :label', {
					label: entry.attribute_label_id,
				})
				.andWhere('value.value_numeric IS NOT NULL')
				.andWhere('variant.product_id IN (:...productIds)', {
					productIds,
				})
				.getMany();

			return this.applyBaseUnit(manager, rows, entry.unit);
		}

		const rows = await manager.getRepository(ProductAttributeEntity).find({
			where: {
				attribute_label_id: entry.attribute_label_id,
				product_id: In(productIds),
			},
		});

		return this.applyBaseUnit(
			manager,
			rows.filter((row) => row.value_numeric !== null),
			entry.unit,
		);
	}

	private async applyBaseUnit<
		T extends { value_numeric: number | null; value_base: number | null },
	>(
		manager: EntityManager,
		rows: T[],
		unit: MeasureUnit | null,
	): Promise<number> {
		if (rows.length === 0) {
			return 0;
		}

		for (const row of rows) {
			row.value_base = toBaseUnit(row.value_numeric as number, unit);
		}

		await manager.save(rows);

		return rows.length;
	}

	/**
	 * The payload's own columns, with an explicitly emptied one restored to `null`.
	 *
	 * The validator folds every empty optional onto `undefined` - the empty value this side is
	 * built with - and zod keeps the key only when the request actually carried it. So a key
	 * that is present and `undefined` is the caller saying *clear this*, while an absent key is
	 * a partial update saying *leave it*, and the two have to reach the row differently: `save`
	 * skips an undefined property, which would make them the same write.
	 *
	 * Without the distinction a definition could never leave `number` - the `unit` and bounds it
	 * was quoted in would survive the change and fail `assertDefinition` on the merged row.
	 */
	private mergeableValues(
		data: ValidatorOutput<ProductCategoryAttributeValidator, 'update'>,
	): Partial<ProductCategoryAttributeEntity> {
		const values = pickValuesFromObject(
			data as unknown as Record<string, unknown>,
			entryColumns,
		);

		for (const column of nullableEntryColumns) {
			if (column in values && values[column] === undefined) {
				values[column] = null;
			}
		}

		return values as Partial<ProductCategoryAttributeEntity>;
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ProductCategoryAttributeEntity> & { id: EntityId },
	): Promise<ProductCategoryAttributeEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ProductCategoryAttributeEntity, saved.id);

		return saved;
	}

	public async updateData(
		entry: ProductCategoryAttributeEntity,
		data: ValidatorOutput<ProductCategoryAttributeValidator, 'update'>,
	): Promise<ProductCategoryAttributeEntity> {
		const previousUnit = entry.unit;

		const updated = await dataSource
			.transaction(async (manager) => {
				const repository = manager.getRepository(
					ProductCategoryAttributeEntity,
				);

				Object.assign(entry, this.mergeableValues(data));

				const optionCount =
					data.options?.length ??
					(
						await manager
							.getRepository(ProductCategoryAttributeEntity)
							.findOne({
								where: { id: entry.id },
								relations: { options: true },
							})
					)?.options?.length ??
					0;

				this.assertDefinition(entry, optionCount);

				const saved = await repository.save(entry);

				if (data.options) {
					await this.repository.syncOptions(
						manager,
						saved.id,
						data.options,
					);
				}

				if (saved.unit !== previousUnit) {
					await this.rewriteBaseValues(manager, saved);
				}

				return saved;
			})
			.catch((error) => {
				throw this.asConflict(error);
			});

		await cleanEntityCache(ProductCategoryAttributeEntity, updated.id);

		return updated;
	}

	/**
	 * A label two of a product's categories cannot agree the scope of.
	 *
	 * Capture, affixes and option list are all things a category may override for a label it
	 * shares - one control, described by whichever definition wins. Scope is not: a label is
	 * either a fact about the product or an axis that separates its variants, and the two are
	 * answered in different places by different rows. Resolving that by depth picks a winner
	 * silently, and the answer stored under the losing scope is then dropped as undeclared -
	 * `ProductAttributeRepository.syncValues` soft-removes whatever the payload omits, and a
	 * form seeded from live rows never offers it again.
	 *
	 * So the disagreement is reported instead of resolved. The categories are named, not just
	 * the label: what an editor has to decide is which of the two the product belongs in, and
	 * the loaded definitions carry only ids. That read happens here, on the failing path alone.
	 */
	private async assertScopeAgreement(
		candidates: DefinitionWithDepth[],
	): Promise<void> {
		const byLabel = new Map<EntityId, DefinitionWithDepth>();

		for (const candidate of candidates) {
			const seen = byLabel.get(candidate.definition.attribute_label_id);

			if (!seen) {
				byLabel.set(candidate.definition.attribute_label_id, candidate);

				continue;
			}

			if (seen.definition.scope === candidate.definition.scope) {
				continue;
			}

			const labels = await dataSource
				.getRepository(CategoryContentEntity)
				.find({
					where: {
						category_id: In([
							seen.definition.category_id,
							candidate.definition.category_id,
						]),
					},
				});

			const nameOf = (category_id: EntityId): string =>
				labels.find((row) => row.category_id === category_id)?.label ??
				`#${category_id}`;

			throw new CustomError(
				422,
				lang('product.error.attribute_scope_conflict', {
					attribute: attributeLabelName(candidate.definition),
					first: nameOf(seen.definition.category_id),
					first_scope: seen.definition.scope,
					second: nameOf(candidate.definition.category_id),
					second_scope: candidate.definition.scope,
				}),
			);
		}
	}

	/**
	 * The definitions a product in these categories renders its form from.
	 *
	 * The set is a union - a product sits in several categories - deduped by label with the
	 * deepest category winning, so a child overrides an ancestor's capture, affixes and option
	 * list rather than adding a second control for the same label. Ties within one depth are
	 * broken by `sort_order`, which is what the repository already ordered by.
	 *
	 * `assertScopeAgreement` is asked for on the write path and not on the read: a form that
	 * cannot be resolved has to say so where the editor is looking, and a `resolve` that threw
	 * would leave the attributes section rendering as though the categories declared nothing.
	 */
	public async resolveForm(
		categoryIds: EntityId[],
		options: { assertScopeAgreement?: boolean } = {},
	): Promise<ResolvedAttributeForm> {
		const definitions =
			await this.repository.findForCategories(categoryIds);

		if (options.assertScopeAgreement) {
			await this.assertScopeAgreement(definitions);
		}

		const winners = new Map<EntityId, DefinitionWithDepth>();

		for (const candidate of definitions) {
			const current = winners.get(
				candidate.definition.attribute_label_id,
			);

			if (!current || candidate.depth > current.depth) {
				winners.set(candidate.definition.attribute_label_id, candidate);
			}
		}

		const resolved = Array.from(winners.values())
			.map((winner) => winner.definition)
			.sort(
				(left, right) =>
					left.sort_order - right.sort_order ||
					compareIds(
						left.attribute_label_id,
						right.attribute_label_id,
					),
			);

		return {
			[ProductCategoryAttributeScopeEnum.PRODUCT]: resolved.filter(
				(definition) =>
					definition.scope ===
					ProductCategoryAttributeScopeEnum.PRODUCT,
			),
			[ProductCategoryAttributeScopeEnum.VARIANT]: resolved.filter(
				(definition) =>
					definition.scope ===
					ProductCategoryAttributeScopeEnum.VARIANT,
			),
		};
	}

	/** The resolved form flattened to a lookup, which is what a value check needs. */
	public async resolveDefinitionsByLabel(
		categoryIds: EntityId[],
		scope: ProductCategoryAttributeScope,
		options: { assertScopeAgreement?: boolean } = {},
	): Promise<Map<EntityId, ProductCategoryAttributeEntity>> {
		const form = await this.resolveForm(categoryIds, options);

		return new Map(
			form[scope].map((definition) => [
				definition.attribute_label_id,
				definition,
			]),
		);
	}

	/**
	 * Reorders one category's definitions - the set a product's form is drawn from, in the order
	 * it draws them.
	 *
	 * Scoped to a single category, because that is what a position means here: definitions from
	 * several categories reach a product through the resolve walk, which sorts the union itself
	 * and would ignore any order agreed across them.
	 *
	 * Ascending, unlike `category.updateOrder` - this table is read `ORDER BY sort_order ASC`
	 * everywhere, so the first id has to come out lowest. The step leaves room to slip a
	 * definition between two later without rewriting the set.
	 */
	public async updateOrder(
		category_id: EntityId,
		ids: EntityId[],
	): Promise<void> {
		await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(
				ProductCategoryAttributeEntity,
			);

			const definitions = await repository.find({
				where: { category_id },
			});

			/*
			 * The submitted ids have to be a complete reordering of that exact set - not a
			 * subset, and nothing from another category. A partial list cannot describe an
			 * order, and a foreign id would silently move a definition out from under the
			 * category that declares it.
			 */
			const found = new Set(
				definitions.map((definition) => definition.id),
			);

			if (
				definitions.length !== ids.length ||
				!ids.every((id) => found.has(id))
			) {
				throw new BadRequestError(
					lang('product.validation.invalid_ids_provided'),
				);
			}

			await repository.save(
				definitions.map((definition) => ({
					...definition,
					sort_order:
						(ids.indexOf(definition.id) + 1) * SORT_ORDER_STEP,
				})),
			);
		});

		await cleanEntityCacheMany(ProductCategoryAttributeEntity, ids);
	}

	public findById(
		id: EntityId,
		withDeleted: boolean,
	): Promise<ProductCategoryAttributeEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	public getEntryData(id: EntityId, withDeleted: boolean) {
		return (
			this.repository
				.createQuery()
				.filterById(id)
				.withDeleted(withDeleted)
				.joinAndSelect(
					'product_category_attribute.options',
					'option',
					'LEFT',
					'option.deleted_at IS NULL',
				)
				// The wording behind each admissible value. The option row holds a `term_id` and
				// nothing readable, so a form editing the list would have to resolve every id
				// separately to name the choices it is showing
				.joinAndSelect('option.term', 'optionTerm', 'LEFT')
				.joinAndSelect(
					'optionTerm.contents',
					'optionTermContent',
					'LEFT',
				)
				.joinAndSelect(
					'product_category_attribute.attribute_label',
					'label',
					'LEFT',
				)
				.joinAndSelect('label.contents', 'labelContent', 'LEFT')
				.orderBy('option.sort_order')
				.firstOrFail()
		);
	}

	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: EntityId) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findByFilter(
		data: ValidatorOutput<ProductCategoryAttributeValidator, 'find'>,
		withDeleted: boolean,
	) {
		return (
			this.repository
				.createQuery()
				/*
				 * The wording, joined rather than left to the caller. A definition carries only
				 * `attribute_label_id`, and a listing has nothing else to name it by - resolving the
				 * ids afterwards would be a second request per page, against an endpoint whose `id`
				 * filter takes one term at a time.
				 *
				 * LEFT on both, so a definition still lists when its label term is soft-deleted or
				 * carries no translation yet; the row comes back with `attribute_label` null or its
				 * `contents` empty. Every language is joined, not one - the client picks, and
				 * `pagination` counts distinct root ids, so the extra rows do not shorten a page.
				 */
				.join(
					'product_category_attribute.attribute_label',
					'label',
					'LEFT',
				)
				.join('label.contents', 'labelContent', 'LEFT')
				.select([
					'product_category_attribute.id',
					'product_category_attribute.category_id',
					'product_category_attribute.attribute_label_id',
					'product_category_attribute.scope',
					'product_category_attribute.value_type',
					'product_category_attribute.type',
					'product_category_attribute.unit',
					'product_category_attribute.prefix',
					'product_category_attribute.suffix',
					'product_category_attribute.min_value',
					'product_category_attribute.max_value',
					'product_category_attribute.is_required',
					'product_category_attribute.is_filterable',
					'product_category_attribute.inherit',
					'product_category_attribute.sort_order',
					'product_category_attribute.created_at',
					'product_category_attribute.updated_at',
					'product_category_attribute.deleted_at',

					'label.id',
					'label.type',

					'labelContent.language',
					'labelContent.value',
				])
				.filterBy(
					'product_category_attribute.category_id',
					data.filter.category_id,
				)
				.filterBy(
					'product_category_attribute.attribute_label_id',
					data.filter.attribute_label_id,
				)
				.filterBy('product_category_attribute.scope', data.filter.scope)
				.filterBy(
					'product_category_attribute.value_type',
					data.filter.value_type,
				)
				.filterByBoolean(
					'product_category_attribute.is_filterable',
					data.filter.is_filterable,
				)
				.filterByBoolean(
					'product_category_attribute.is_required',
					data.filter.is_required,
				)
				.withDeleted(withDeleted && data.filter.is_deleted)
				.orderBy(data.order_by, data.direction)
				.pagination(data.page, data.limit)
				.all(true)
		);
	}
}

export const productCategoryAttributeService =
	new ProductCategoryAttributeService(ProductCategoryAttributeRepository);
