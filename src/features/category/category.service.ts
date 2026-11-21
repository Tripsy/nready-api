import type { DeepPartial, EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import CategoryEntity, {
	CATEGORY_MAX_DEPTH,
	type CategoryStatus,
	CategoryStatusEnum,
	type CategoryType,
	STATUS_TRANSITIONS,
} from '@/features/category/category.entity';
import {
	type CategoryQuery,
	getCategoryRepository,
} from '@/features/category/category.repository';
import {
	type CategoryValidator,
	OrderByEnum,
} from '@/features/category/category.validator';
import CategoryContentRepository from '@/features/category/category-content.repository';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * `CASE` mapping each category type to its depth ceiling, for the `can_parent` filter.
 *
 * Built from `CATEGORY_MAX_DEPTH` rather than written out, so adding a type cannot leave the
 * filter silently applying the wrong limit. The values are this module's own constants, never
 * client input, which is what makes the interpolation safe.
 */
const MAX_DEPTH_SQL_CASE = `CASE category.type ${Object.entries(
	CATEGORY_MAX_DEPTH,
)
	.map(([type, maxDepth]) => `WHEN '${type}' THEN ${maxDepth}`)
	.join(' ')} END`;

export class CategoryService {
	constructor(
		private repository: ReturnType<typeof getCategoryRepository>,
		private getScopedCategoryRepository: (
			manager?: EntityManager,
		) => Repository<CategoryEntity>,
	) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<CategoryValidator, 'create'>,
	): Promise<CategoryEntity> {
		return dataSource.transaction(async (manager) => {
			const repository = this.getScopedCategoryRepository(manager);

			const entry: DeepPartial<CategoryEntity> = {
				type: data.type,
				parent: null,
			};

			if (data.parent_id) {
				const parent = await repository
					.createQueryBuilder()
					.where('id = :id', {
						id: data.parent_id,
					})
					.getOne();

				if (parent) {
					if (data.type !== parent.type) {
						throw new CustomError(
							400,
							lang('category.error.invalid_parent_type'),
						);
					}

					await this.assertDepthFits(data.type, parent, 1);

					entry.parent = parent;
				} else {
					throw new CustomError(
						409,
						lang('category.error.parent_not_found'),
					);
				}
			}

			const entrySaved = await repository.save(entry);

			await CategoryContentRepository.saveContent(
				manager,
				data.contents,
				entrySaved.id,
				entrySaved.type,
			);

			return entrySaved;
		});
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 *
	 * `entry` must carry its `parent` relation - load it with `findByIdWithParent`. The relation
	 * is not eager, so an entry loaded without it reads as a root: a move would compare against
	 * the wrong current parent and a detach would find nothing to clear.
	 */
	public async updateDataWithContent(
		entry: CategoryEntity,
		data: ValidatorOutput<CategoryValidator, 'update'>,
	) {
		const currentParentId = entry.parent?.id ?? null;

		/*
		 * Key presence is what marks an intentional re-parent, not the value: the validator's
		 * `preprocessOptional` folds a client's `null` onto the configured empty value
		 * (`undefined` on the backend), so the only signal left is that `parent_id` was sent at
		 * all. A falsy value therefore means "clear the parent"; `validateId` rejects `0`, so no
		 * real id can be read as a detach.
		 */
		const newParentId =
			'parent_id' in data ? (data.parent_id ?? null) : currentParentId;
		const hasMoved = newParentId !== currentParentId;

		if (data.parent_id) {
			if (currentParentId === data.parent_id) {
				throw new CustomError(400, lang('category.error.parent_same'));
			}

			const newParent = await this.findById(data.parent_id, true);

			if (!newParent) {
				throw new CustomError(
					409,
					lang('category.error.parent_not_found'),
				);
			}

			if (newParent.deleted_at && !entry.deleted_at) {
				throw new CustomError(
					400,
					lang('category.error.parent_deleted'),
				);
			}

			if (
				newParent.status !== CategoryStatusEnum.ACTIVE &&
				entry.status === CategoryStatusEnum.ACTIVE
			) {
				throw new CustomError(
					400,
					lang('category.error.parent_not_active'),
				);
			}

			if (entry.type !== newParent.type) {
				throw new CustomError(
					400,
					lang('category.error.invalid_parent_type', {
						type: entry.type,
					}),
				);
			}
		}

		/*
		 * Loaded once for two uses: the cycle guard below, and the cache clean after the
		 * commit - a move re-roots the whole subtree, so every descendant's `with_ancestors`
		 * read is stale. `findDescendants` includes `entry` itself.
		 */
		const descendants = hasMoved
			? await RepositoryAbstract.getTreeRepository(
					CategoryEntity,
				).findDescendants(entry)
			: [];

		if (
			data.parent_id &&
			descendants.some((d) => d.id === data.parent_id)
		) {
			throw new CustomError(
				400,
				lang('category.error.parent_descendant'),
			);
		}

		/*
		 * Checked after the cycle guard, so moving a category under its own descendant is
		 * still reported as that rather than as a depth failure. What has to fit is the whole
		 * subtree, not the moved node - a two-level branch needs two levels of room.
		 */
		if (data.parent_id) {
			await this.assertDepthFits(
				entry.type,
				await this.findById(data.parent_id, true),
				await this.getSubtreeHeight(entry),
			);
		}

		const updatedEntry = await dataSource.transaction(async (manager) => {
			if (hasMoved) {
				const repository = manager.getRepository(CategoryEntity); // We use the manager -> `getCategoryRepository` is not bound to the transaction

				entry.parent = newParentId
					? ({ id: newParentId } as CategoryEntity)
					: null;

				/*
				 * Position is meaningful only among siblings, and the move lands the
				 * category in a group it was never ordered against - carrying the old
				 * value over would place it arbitrarily. Zero puts it at the end until
				 * the group is reordered.
				 */
				entry.sort_order = 0;

				await repository.save(entry);
			}

			if (data.contents) {
				await CategoryContentRepository.saveContent(
					manager,
					data.contents,
					entry.id,
					entry.type,
				);
			}

			return entry;
		});

		// One clean for the whole operation, after commit - the content rows written above
		// have no subscriber invalidating the category's keys, and a contents-only update
		// never saves the category row either. See `cleanEntityCache`
		await cleanEntityCache(CategoryEntity, updatedEntry.id);

		if (hasMoved) {
			/*
			 * A move invalidates rows that were never written, so no subscriber speaks for
			 * them: both sibling groups cache the moved row under `with_children`, and the
			 * subtree caches the old chain under `with_ancestors`. Each id is one Redis
			 * SCAN, which is why the set is built only for an actual move.
			 */
			const staleIds = new Set<EntityId>(descendants.map((d) => d.id));

			for (const parentId of [currentParentId, newParentId]) {
				if (parentId) {
					staleIds.add(parentId);
				}
			}

			staleIds.delete(updatedEntry.id); // Already cleaned above

			for (const staleId of staleIds) {
				await cleanEntityCache(CategoryEntity, staleId);
			}
		}

		return updatedEntry;
	}

	public async updateStatus(
		entry: CategoryEntity,
		newStatus: CategoryStatus,
		forceUpdate?: boolean, // When `true` & newStatus is CategoryStatusEnum.INACTIVE the active descendants will also be marked as inactive
	): Promise<void> {
		const cascadedIds = await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(CategoryEntity); // We use the manager -> `getCategoryRepository` is not bound to the transaction

			// Collected inside the transaction, cleaned after it commits.
			const cascadedIds: EntityId[] = [];

			assertValidStatusTransition(
				STATUS_TRANSITIONS,
				entry.status,
				newStatus,
			);

			if (newStatus === CategoryStatusEnum.INACTIVE) {
				const treeRepository =
					manager.getTreeRepository(CategoryEntity);

				const activeDescendantsData = await treeRepository
					.createDescendantsQueryBuilder('category', 'closure', entry)
					.select('category.id', 'id')
					.where('category.status = :status', {
						status: CategoryStatusEnum.ACTIVE,
					})
					.getRawMany<{ id: EntityId }>();

				const activeDescendants = activeDescendantsData.filter(
					(d) => d.id !== entry.id,
				);

				if (activeDescendants.length > 0) {
					if (!forceUpdate) {
						throw new CustomError(
							400,
							lang('category.error.has_active_descendants'),
						);
					} else {
						await repository
							.createQueryBuilder()
							.update(CategoryEntity)
							.set({
								status: CategoryStatusEnum.INACTIVE,
								// Cascaded rows leave their sibling group as well, so
								// they are reset for the same reason `entry` is.
								sort_order: 0,
							})
							.where('id IN (:...ids)', {
								ids: activeDescendants.map((d) => d.id),
							})
							.execute();

						cascadedIds.push(...activeDescendants.map((d) => d.id));
					}
				}
			}

			entry.status = newStatus;

			/*
			 * Only active categories are orderable, so a status change takes the row out of
			 * its sibling group - or brings it back into one that has been reordered since.
			 * Either way the stored position is stale; zero puts it at the end until the
			 * group is reordered. Same rule as `brand`.
			 */
			entry.sort_order = 0;

			await repository.save(entry);

			return cascadedIds;
		});

		await cleanEntityCache(CategoryEntity, entry.id);

		/*
		 * The cascade above is a bulk `UPDATE ... WHERE id IN (...)`, which loads no entities and
		 * so has never announced itself - those descendants changed status with nothing dropping
		 * their cached reads.
		 */
		await cleanEntityCacheMany(CategoryEntity, cascadedIds);
	}

	/**
	 * @description Used in `orderUpdate` method from controller; reorders one sibling group
	 */
	public async updateOrder(
		type: CategoryType,
		parent_id: EntityId | undefined,
		ids: EntityId[], // Array of IDs in the desired order
	): Promise<void> {
		await dataSource.transaction(async (manager) => {
			const categoryRepository = manager.getRepository(CategoryEntity);

			/*
			 * A position only means something among siblings, so the orderable set is one
			 * group: same type, same parent - or the roots when no parent is given. `type`
			 * is part of it because product and article roots both carry a null parent and
			 * would otherwise be ordered against each other.
			 */
			const categoryQuery = categoryRepository
				.createQueryBuilder('category')
				.where('category.type = :type', { type })
				.andWhere('category.status = :status', {
					status: CategoryStatusEnum.ACTIVE,
				});

			if (parent_id) {
				categoryQuery.andWhere('category.parent_id = :parent_id', {
					parent_id,
				});
			} else {
				categoryQuery.andWhere('category.parent_id IS NULL');
			}

			const categories = await categoryQuery.getMany();

			// The submitted ids must be a complete reordering of that exact set, not a
			// subset and not a mix with ids from another group.
			const foundIds = new Set(categories.map((category) => category.id));
			const allProvidedAreValid = ids.every((id) => foundIds.has(id));

			if (categories.length !== ids.length || !allProvidedAreValid) {
				throw new BadRequestError(
					lang('category.validation.invalid_ids_provided'),
				);
			}

			const updatedCategories = categories.map((category) => {
				const position = ids.indexOf(category.id);

				category.sort_order = ids.length - position;

				return category;
			});

			// Save all - row by row, so each write is audited; the cache is dropped after
			// the transaction commits, below
			await categoryRepository.save(updatedCategories);
		});

		// Every row moved, in one pass: a reorder rewrites the whole group, and the
		// order a reader sees comes from these rows. See `cleanEntityCacheMany`
		await cleanEntityCacheMany(CategoryEntity, ids);
	}

	public async delete(id: EntityId) {
		const category = await this.findById(id, true);

		if (category.deleted_at) {
			throw new CustomError(409, lang('category.error.already_deleted'));
		}

		const treeRepository =
			RepositoryAbstract.getTreeRepository(CategoryEntity);

		const descendants = await treeRepository.findDescendants(category);

		const hasActiveDescendant = descendants.some(
			(d) => d.id !== category.id && !d.deleted_at,
		);

		if (hasActiveDescendant) {
			throw new CustomError(409, lang('category.error.has_descendants'));
		}

		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: EntityId) {
		const category = await this.repository
			.createQuery()
			.joinAndSelect('category.parent', 'parent', 'LEFT')
			.filterById(id)
			.withDeleted(true)
			.firstOrFail();

		if (category.deleted_at === null) {
			throw new CustomError(400, lang('category.error.not_deleted'));
		}

		if (category.parent?.deleted_at) {
			throw new CustomError(400, lang('category.error.parent_deleted'));
		}

		if (
			category.parent &&
			category.parent.status !== CategoryStatusEnum.ACTIVE
		) {
			throw new CustomError(
				400,
				lang('category.error.parent_not_active'),
			);
		}

		await this.repository.createQuery().filterById(id).restore();
	}

	/**
	 * How many levels a category sits under the root, itself included - a root is 1.
	 *
	 * Read from the closure table through `findAncestors`, which returns the node plus every
	 * ancestor, rather than by walking `parent` one query at a time.
	 */
	private async getDepth(entry: CategoryEntity): Promise<number> {
		const ancestors =
			await RepositoryAbstract.getTreeRepository(
				CategoryEntity,
			).findAncestors(entry);

		return ancestors.length;
	}

	/**
	 * How many levels the subtree rooted at `entry` spans - a leaf is 1.
	 *
	 * A move takes the whole subtree with it, so this is what has to fit under the new
	 * parent, not just the moved node.
	 */
	private async getSubtreeHeight(entry: CategoryEntity): Promise<number> {
		const tree = (await RepositoryAbstract.getTreeRepository(
			CategoryEntity,
		).findDescendantsTree(entry)) as CategoryEntity;

		// `children` is only populated on a tree read, so the cast is what the shared
		// `getTreeRepository` (typed `ObjectLiteral`) gives back rather than a claim about
		// the row.
		const measure = (node: CategoryEntity): number =>
			1 +
			Math.max(
				0,
				...(node.children ?? []).map((child) => measure(child)),
			);

		return measure(tree);
	}

	/**
	 * Refuses a placement that would push the tree past its type's ceiling.
	 *
	 * `height` is the depth of what is being placed - 1 for a new category, the subtree's
	 * own height for a move.
	 */
	private async assertDepthFits(
		type: CategoryType,
		parent: CategoryEntity,
		height: number,
	): Promise<void> {
		const maxDepth = CATEGORY_MAX_DEPTH[type];

		if ((await this.getDepth(parent)) + height > maxDepth) {
			throw new CustomError(
				400,
				lang('category.error.max_depth', {
					type,
					max: String(maxDepth),
				}),
			);
		}
	}

	public findById(
		id: EntityId,
		withDeleted: boolean,
	): Promise<CategoryEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description The loader for anything that re-parents; see `updateDataWithContent`, which
	 * cannot tell a root from an entry whose relation was simply left unloaded.
	 */
	public findByIdWithParent(
		id: EntityId,
		withDeleted: boolean,
	): Promise<CategoryEntity> {
		return this.repository
			.createQuery()
			.joinAndSelect('category.parent', 'parent', 'LEFT')
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * Contents are joined the same way everywhere: narrowed to the requested language, or all
	 * rows when none is given. The join type applies only to the language-narrowed case - a
	 * category with no content in that language is not a result (INNER), but the same absence
	 * on a *related* category must not drop the relation itself (LEFT).
	 */
	private joinContents(
		query: CategoryQuery,
		relation: string,
		alias: string,
		language: string | undefined,
		type: 'INNER' | 'LEFT' = 'INNER',
	): CategoryQuery {
		if (language) {
			return query.joinAndSelect(
				relation,
				alias,
				type,
				`${alias}.language = :language`,
				{ language },
			);
		}

		return query.joinAndSelect(relation, alias, 'LEFT');
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: {
		id: EntityId;
		with_ancestors: boolean;
		with_children: boolean;
		language: string | undefined;
		withDeleted: boolean;
	}) {
		const categoryQuery = this.repository
			.createQuery()
			.filterById(data.id)
			.withDeleted(data.withDeleted);

		this.joinContents(
			categoryQuery,
			'category.contents',
			'content',
			data.language,
		);

		// The immediate parent rides along unconditionally: `with_ancestors` answers a
		// different question (the whole chain, for a breadcrumb) and the edit form needs the
		// one relation it is allowed to change.
		categoryQuery.joinAndSelect('category.parent', 'parent', 'LEFT');

		this.joinContents(
			categoryQuery,
			'parent.contents',
			'parentContent',
			data.language,
			'LEFT',
		);

		const categoryEntry = await categoryQuery.firstOrFail();

		const treeRepository =
			RepositoryAbstract.getTreeRepository(CategoryEntity);

		let ancestorsWithContent: CategoryEntity[] = [];
		let childrenWithContent: CategoryEntity[] = [];

		if (data.with_ancestors || data.with_children) {
			const ancestors = await treeRepository.findAncestors(categoryEntry);

			if (data.with_ancestors) {
				const orderedIds = ancestors
					.filter((a) => a.id !== categoryEntry.id) // Exclude the current category
					.map((a) => a.id);

				const ancestorsWithContentDataQuery = getCategoryRepository()
					.createQuery()
					.filterBy('id', orderedIds, 'IN')
					.withDeleted(data.withDeleted);

				this.joinContents(
					ancestorsWithContentDataQuery,
					'category.contents',
					'content',
					data.language,
				);

				const ancestorsWithContentData =
					await ancestorsWithContentDataQuery.all();

				ancestorsWithContent = orderedIds
					.map((id) =>
						ancestorsWithContentData.find((a) => a.id === id),
					)
					.filter((a): a is CategoryEntity => a !== undefined);
			}

			if (data.with_children) {
				const childrenWithContentQuery = getCategoryRepository()
					.createQuery()
					.filterBy('parent_id', categoryEntry.id)
					.withDeleted(data.withDeleted);

				this.joinContents(
					childrenWithContentQuery,
					'category.contents',
					'content',
					data.language,
				);

				childrenWithContent = await childrenWithContentQuery.all();
			}
		}

		return {
			...categoryEntry,
			...(data.with_ancestors && {
				ancestors: ancestorsWithContent,
			}),
			...(data.with_children && {
				children: childrenWithContent,
			}),
		};
	}

	/**
	 * @description Used in `find` method from the public controller; the anonymous listing
	 *
	 * Status is pinned here rather than taken from the payload, and soft-deleted rows are
	 * never included - the validator has no filter that could widen either.
	 */
	public findByFilterPublic(
		data: ValidatorOutput<CategoryValidator, 'publicFind'>,
	) {
		const orderBy =
			data.order_by === OrderByEnum.LABEL
				? 'content.label'
				: data.order_by;

		const query = this.repository
			.createQuery()
			.join(
				'category.contents',
				'content',
				'INNER',
				'content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.join('category.parent', 'parent', 'LEFT')
			.select([
				'category.id',
				'category.type',
				'category.sort_order',

				'content.language',
				'content.label',
				'content.slug',
				'content.description',
				'content.meta',

				// The id alone: enough for a caller to nest the rows it was given, without
				// naming a category the listing did not otherwise return.
				'parent.id',
			])
			.filterBy('type', data.filter.type)
			.filterBy('status', CategoryStatusEnum.ACTIVE);

		if (data.filter.is_root) {
			query.getQuery().andWhere('category.parent_id IS NULL');
		} else {
			query.filterBy('parent.id', data.filter.parent_id);
		}

		return query
			.orderBy(orderBy, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}

	public findByFilter(
		data: ValidatorOutput<CategoryValidator, 'find'>,
		withDeleted: boolean,
	) {
		/*
		 * `orderBy` prefixes a bare column with the root alias, and `label` lives on the
		 * joined content row - passed through unmapped it builds `category.label`, which
		 * is not a column and fails at the database.
		 */
		const orderBy =
			data.order_by === OrderByEnum.LABEL
				? 'content.label'
				: data.order_by;

		const query = this.repository
			.createQuery()
			.join(
				'category.contents',
				'content',
				'INNER',
				'content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.join('category.parent', 'parent', 'LEFT')
			.join(
				'parent.contents',
				'parentContent',
				'LEFT',
				'parentContent.language = :language',
				{
					language: data.filter.language,
				},
			)
			.select([
				'category.id',
				'category.type',
				'category.status',
				'category.sort_order',
				'category.created_at',
				'category.deleted_at',

				'content.language',
				'content.label',
				'content.slug',

				'parent.id',

				'parentContent.label',
			])
			.filterById(data.filter.id)
			.filterBy('type', data.filter.type)
			.filterBy('status', data.filter.status)
			.filterByTerm(data.filter.term);

		if (data.filter.can_parent) {
			/*
			 * Depth is the closure row count for the category as a descendant - the table
			 * carries a self-reference, so a root counts 1. A category may take a child
			 * while that count is below its type's ceiling.
			 */
			query.filterRaw(
				`(SELECT COUNT(*) FROM category_closure cc WHERE cc.id_descendant = category.id) < ${MAX_DEPTH_SQL_CASE}`,
			);
		}

		// Mirrors the grouping `updateOrder` enforces: same type, same parent - or the
		// roots, which `filterBy` cannot express because it drops null values.
		if (data.filter.is_root) {
			query.getQuery().andWhere('category.parent_id IS NULL');
		} else {
			query.filterBy('parent.id', data.filter.parent_id);
		}

		return query
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(orderBy, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export function getScopedCategoryRepository(manager?: EntityManager) {
	return (manager ?? dataSource.manager).getRepository(CategoryEntity);
}

export const categoryService = new CategoryService(
	getCategoryRepository(),
	getScopedCategoryRepository,
);
