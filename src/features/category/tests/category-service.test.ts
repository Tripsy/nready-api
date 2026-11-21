import { expect, jest } from '@jest/globals';
import type {
	DeepPartial,
	EntityManager,
	Repository,
	TreeRepository,
} from 'typeorm';
import type CategoryEntity from '@/features/category/category.entity';
import {
	CategoryStatusEnum,
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import {
	categoryInputPayloads,
	categoryOutputPayloads,
	getCategoryEntityMock,
} from '@/features/category/category.mock';
import type { CategoryQuery } from '@/features/category/category.repository';
import { CategoryService } from '@/features/category/category.service';
import type { CategoryValidator } from '@/features/category/category.validator';
import CategoryContentRepository from '@/features/category/category-content.repository';
import { createCurrentDate } from '@/helpers/date.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import {
	createMockRepository,
	setupTransactionMock,
	testServiceFindByFilter,
	testServiceFindById,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

/** A category with the fields each tree test cares about, defaults left alone. */
function buildCategory(
	overrides: Partial<CategoryEntity> = {},
): CategoryEntity {
	return {
		...getCategoryEntityMock(),
		...overrides,
	};
}

/**
 * Stubs the tree repository behind `RepositoryAbstract.getTreeRepository`, which the service
 * reaches for statically. All three reads it performs have to answer, because the depth ceiling
 * is checked on every placement and a stub missing one fails the test that placement succeeds:
 *
 * - `findDescendants` guards reparenting (a category cannot move under its own descendant) and
 *   deletion. It includes the subject itself.
 * - `findAncestors` is how `getDepth` measures the prospective parent - the returned length *is*
 *   the depth, so one entry means a root.
 * - `findDescendantsTree` is how `getSubtreeHeight` measures what is being moved; height comes
 *   from `children`, so a node without any is a leaf of height 1.
 *
 * The defaults describe the ordinary case - placing a leaf under a root, which fits every
 * `CATEGORY_MAX_DEPTH`. A test about the ceiling passes its own.
 */
function mockTreeRepository(
	descendants: CategoryEntity[],
	options: {
		ancestors?: CategoryEntity[];
		subtree?: CategoryEntity;
	} = {},
) {
	const findDescendants = jest
		.fn<(entity: CategoryEntity) => Promise<CategoryEntity[]>>()
		.mockResolvedValue(descendants);

	const findAncestors = jest
		.fn<(entity: CategoryEntity) => Promise<CategoryEntity[]>>()
		.mockResolvedValue(
			options.ancestors ?? [buildCategory({ id: mockId(9) })],
		);

	const findDescendantsTree = jest
		.fn<(entity: CategoryEntity) => Promise<CategoryEntity>>()
		.mockResolvedValue(
			options.subtree ?? buildCategory({ id: mockId(1), children: [] }),
		);

	jest.spyOn(RepositoryAbstract, 'getTreeRepository').mockReturnValue({
		findDescendants,
		findAncestors,
		findDescendantsTree,
	} as unknown as TreeRepository<CategoryEntity>);

	return { findDescendants, findAncestors, findDescendantsTree };
}

describe('CategoryService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockCategory = createMockRepository<CategoryEntity, CategoryQuery>();
	const getScopedCategoryRepository = jest.fn() as jest.MockedFunction<
		(manager?: EntityManager) => Repository<CategoryEntity>
	>;

	const serviceCategory = new CategoryService(
		mockCategory.repository,
		getScopedCategoryRepository,
	);

	/**
	 * `create` resolves the parent through a scoped repository so the lookup joins the
	 * transaction; the parent is assigned as an *entity* rather than a `parent_id`, which
	 * is what makes TypeORM write the closure rows.
	 */
	describe('create - parent resolution', () => {
		function mockScopedRepository(
			parent: CategoryEntity | null,
			saved: CategoryEntity,
		) {
			const queryBuilder = {
				where: jest.fn().mockReturnThis(),
				getOne: jest
					.fn<() => Promise<CategoryEntity | null>>()
					.mockResolvedValue(parent),
			};

			const repository = {
				createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
				save: jest
					.fn<
						(
							entry: DeepPartial<CategoryEntity>,
						) => Promise<CategoryEntity>
					>()
					.mockResolvedValue(saved),
			};

			getScopedCategoryRepository.mockReturnValue(
				repository as unknown as Repository<CategoryEntity>,
			);

			return repository;
		}

		it('should attach the resolved parent entity and save inside the transaction', async () => {
			const createData = categoryOutputPayloads.create;
			const parent = buildCategory({
				id: mockId(5),
				type: createData.type,
			});
			const saved = buildCategory({
				id: mockId(9),
				type: createData.type,
			});

			const { transaction } = setupTransactionMock();
			const repository = mockScopedRepository(parent, saved);

			// A create is placed under the parent, so the depth ceiling is checked and the tree
			// has to answer - the default puts the parent at the root, where a new leaf fits.
			mockTreeRepository([]);

			const saveContent = jest
				.spyOn(CategoryContentRepository, 'saveContent')
				.mockResolvedValue(undefined);

			const result = await serviceCategory.create(createData);

			expect(transaction).toHaveBeenCalled();
			expect(repository.save).toHaveBeenCalledWith({
				type: createData.type,
				parent,
			});
			expect(saveContent).toHaveBeenCalledWith(
				expect.anything(),
				createData.contents,
				saved.id,
				saved.type,
			);
			expect(result).toBe(saved);
		});

		/*
		 * `ARTICLE` tops out at 2 levels (`CATEGORY_MAX_DEPTH`), so a parent that is already
		 * two deep leaves no room for a child. This is the case the tree stub exists for - a
		 * placement is refused by measuring, not by anything on the row.
		 */
		it('should throw when the parent is already at the depth ceiling', async () => {
			const createData = categoryOutputPayloads.create;
			const parent = buildCategory({
				id: mockId(5),
				type: createData.type,
			});

			setupTransactionMock();
			mockScopedRepository(parent, buildCategory());

			mockTreeRepository([], {
				ancestors: [parent, buildCategory({ id: mockId(9) })],
			});

			await expect(serviceCategory.create(createData)).rejects.toThrow(
				'category.error.max_depth',
			);
		});

		it('should throw when the parent belongs to another type', async () => {
			const createData = categoryOutputPayloads.create;

			setupTransactionMock();
			mockScopedRepository(
				buildCategory({
					id: mockId(5),
					type: CategoryTypeEnum.PRODUCT,
				}),
				buildCategory(),
			);

			await expect(serviceCategory.create(createData)).rejects.toThrow(
				'category.error.invalid_parent_type',
			);
		});

		it('should throw when the parent does not exist', async () => {
			const createData = categoryOutputPayloads.create;

			setupTransactionMock();
			const repository = mockScopedRepository(null, buildCategory());

			await expect(serviceCategory.create(createData)).rejects.toThrow(
				'category.error.parent_not_found',
			);

			expect(repository.save).not.toHaveBeenCalled();
		});
	});

	/**
	 * Reparenting is the operation that can corrupt the tree - every guard below exists to
	 * stop a cycle, a cross-type graft or a move under a row that is on its way out.
	 */
	describe('updateDataWithContent - reparenting guards', () => {
		const updateData = categoryOutputPayloads.update; // parent_id: mockId(3)

		it('should reject moving a category under its current parent', async () => {
			const entry = buildCategory({
				id: mockId(1),
				parent: buildCategory({ id: updateData.parent_id }),
			});

			await expect(
				serviceCategory.updateDataWithContent(entry, updateData),
			).rejects.toThrow('category.error.parent_same');
		});

		it('should reject a deleted parent for a live category', async () => {
			const entry = buildCategory({
				id: mockId(1),
				deleted_at: null,
				parent: buildCategory({ id: mockId(9) }),
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({
					id: updateData.parent_id,
					deleted_at: createCurrentDate(),
				}),
			);

			await expect(
				serviceCategory.updateDataWithContent(entry, updateData),
			).rejects.toThrow('category.error.parent_deleted');
		});

		it('should reject an inactive parent for an active category', async () => {
			const entry = buildCategory({
				id: mockId(1),
				status: CategoryStatusEnum.ACTIVE,
				parent: buildCategory({ id: mockId(9) }),
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({
					id: updateData.parent_id,
					status: CategoryStatusEnum.PENDING,
				}),
			);

			await expect(
				serviceCategory.updateDataWithContent(entry, updateData),
			).rejects.toThrow('category.error.parent_not_active');
		});

		it('should reject a parent of a different type', async () => {
			const entry = buildCategory({
				id: mockId(1),
				type: CategoryTypeEnum.ARTICLE,
				parent: buildCategory({ id: mockId(9) }),
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({
					id: updateData.parent_id,
					type: CategoryTypeEnum.PRODUCT,
				}),
			);

			await expect(
				serviceCategory.updateDataWithContent(entry, updateData),
			).rejects.toThrow('category.error.invalid_parent_type');
		});

		it('should reject moving a category under its own descendant (cycle)', async () => {
			const entry = buildCategory({
				id: mockId(1),
				parent: buildCategory({ id: mockId(9) }),
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({ id: updateData.parent_id }),
			);

			// `findDescendants` includes the subject itself, hence both ids.
			const { findDescendants } = mockTreeRepository([
				buildCategory({ id: mockId(1) }),
				buildCategory({ id: updateData.parent_id }),
			]);

			await expect(
				serviceCategory.updateDataWithContent(entry, updateData),
			).rejects.toThrow('category.error.parent_descendant');

			expect(findDescendants).toHaveBeenCalledWith(entry);
		});

		/*
		 * A move takes the whole subtree with it, so what has to fit is its height and not the
		 * single node: a two-level subtree under a root already spans the `ARTICLE` ceiling of
		 * 2, and the child below it would be a third.
		 */
		it('should measure the moved subtree against the ceiling, not just the node', async () => {
			const entry = buildCategory({
				id: mockId(1),
				parent: buildCategory({ id: mockId(9) }),
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({ id: updateData.parent_id }),
			);

			mockTreeRepository([buildCategory({ id: mockId(1) })], {
				subtree: buildCategory({
					id: mockId(1),
					children: [buildCategory({ id: mockId(2), children: [] })],
				}),
			});

			await expect(
				serviceCategory.updateDataWithContent(entry, updateData),
			).rejects.toThrow('category.error.max_depth');
		});

		it('should save the new parent and the contents when every guard passes', async () => {
			const entry = buildCategory({
				id: mockId(1),
				sort_order: 30,
				parent: buildCategory({ id: mockId(9) }),
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({ id: updateData.parent_id }),
			);

			mockTreeRepository([buildCategory({ id: mockId(1) })]);

			const scopedRepository = {
				save: jest.fn<
					(entry: CategoryEntity) => Promise<CategoryEntity>
				>(),
			};

			const { transaction, manager } = setupTransactionMock();
			manager.getRepository.mockReturnValue(scopedRepository);

			const saveContent = jest
				.spyOn(CategoryContentRepository, 'saveContent')
				.mockResolvedValue(undefined);

			const result = await serviceCategory.updateDataWithContent(
				entry,
				updateData,
			);

			expect(transaction).toHaveBeenCalled();
			expect(entry.parent).toEqual({ id: updateData.parent_id });
			// The move lands it in a group it was never ordered against.
			expect(entry.sort_order).toBe(0);
			expect(scopedRepository.save).toHaveBeenCalledWith(entry);
			expect(saveContent).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(Array),
				entry.id,
				entry.type,
			);
			expect(result).toBe(entry);
		});

		/*
		 * A client detaches by sending `parent_id: null`, which the validator folds to
		 * `undefined` - so the payload reaching the service carries the key with a falsy
		 * value. Sent alongside `contents` because the `params_at_least_one` refine still
		 * rejects a detach-only body.
		 */
		it('should detach the parent when parent_id is sent empty', async () => {
			const entry = buildCategory({
				id: mockId(1),
				sort_order: 30,
				parent: buildCategory({ id: mockId(9) }),
			});

			const detachData = { ...updateData, parent_id: undefined };

			const findById = jest.spyOn(serviceCategory, 'findById');

			mockTreeRepository([buildCategory({ id: mockId(1) })]);

			const scopedRepository = {
				save: jest.fn<
					(entry: CategoryEntity) => Promise<CategoryEntity>
				>(),
			};

			const { manager } = setupTransactionMock();
			manager.getRepository.mockReturnValue(scopedRepository);

			jest.spyOn(
				CategoryContentRepository,
				'saveContent',
			).mockResolvedValue(undefined);

			await serviceCategory.updateDataWithContent(entry, detachData);

			// No parent to resolve, so none of the reparenting guards should run.
			expect(findById).not.toHaveBeenCalled();
			expect(entry.parent).toBeNull();
			expect(entry.sort_order).toBe(0);
			expect(scopedRepository.save).toHaveBeenCalledWith(entry);
		});

		/*
		 * The mirror of the detach: a root has no `parent` to compare against, and the branch
		 * used to be gated on that relation being present - which made adopting a root a
		 * silent no-op.
		 */
		it('should attach a parent to a category that has none', async () => {
			const entry = buildCategory({
				id: mockId(1),
				sort_order: 30,
				parent: null,
			});

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({ id: updateData.parent_id }),
			);

			mockTreeRepository([buildCategory({ id: mockId(1) })]);

			const scopedRepository = {
				save: jest.fn<
					(entry: CategoryEntity) => Promise<CategoryEntity>
				>(),
			};

			const { manager } = setupTransactionMock();
			manager.getRepository.mockReturnValue(scopedRepository);

			jest.spyOn(
				CategoryContentRepository,
				'saveContent',
			).mockResolvedValue(undefined);

			await serviceCategory.updateDataWithContent(entry, updateData);

			expect(entry.parent).toEqual({ id: updateData.parent_id });
			expect(entry.sort_order).toBe(0);
			expect(scopedRepository.save).toHaveBeenCalledWith(entry);
		});

		it('should leave the row alone when parent_id repeats the current parent of a root', async () => {
			const entry = buildCategory({
				id: mockId(1),
				sort_order: 30,
				parent: null,
			});

			const scopedRepository = {
				save: jest.fn<
					(entry: CategoryEntity) => Promise<CategoryEntity>
				>(),
			};

			const { manager } = setupTransactionMock();
			manager.getRepository.mockReturnValue(scopedRepository);

			jest.spyOn(
				CategoryContentRepository,
				'saveContent',
			).mockResolvedValue(undefined);

			await serviceCategory.updateDataWithContent(entry, {
				...updateData,
				parent_id: undefined,
			});

			// Nothing moved, so the position it was given among its siblings survives.
			expect(entry.sort_order).toBe(30);
			expect(scopedRepository.save).not.toHaveBeenCalled();
		});
	});

	/**
	 * Deactivating a branch has to take the branch with it, or the tree ends up with active
	 * children hanging off an inactive parent.
	 */
	describe('updateStatus - descendant cascade', () => {
		function mockDescendantsQuery(activeIds: EntityId[]) {
			const descendantsQueryBuilder = {
				select: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				getRawMany: jest
					.fn<() => Promise<{ id: EntityId }[]>>()
					.mockResolvedValue(activeIds.map((id) => ({ id }))),
			};

			const treeRepository = {
				createDescendantsQueryBuilder: jest
					.fn()
					.mockReturnValue(descendantsQueryBuilder),
			};

			const updateQueryBuilder = {
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				execute: jest
					.fn<() => Promise<unknown>>()
					.mockResolvedValue({}),
			};

			const scopedRepository = {
				createQueryBuilder: jest
					.fn()
					.mockReturnValue(updateQueryBuilder),
				save: jest.fn<
					(entry: CategoryEntity) => Promise<CategoryEntity>
				>(),
			};

			const { transaction, manager } = setupTransactionMock();

			manager.getRepository.mockReturnValue(scopedRepository);
			// `setupTransactionMock` builds a plain object, so the tree accessor the
			// service calls on the manager has to be added here.
			Object.assign(manager, {
				getTreeRepository: jest.fn().mockReturnValue(treeRepository),
			});

			return {
				transaction,
				scopedRepository,
				updateQueryBuilder,
				treeRepository,
			};
		}

		it('should refuse to deactivate a category that still has active descendants', async () => {
			const entry = buildCategory({
				id: mockId(1),
				status: CategoryStatusEnum.ACTIVE,
			});

			mockDescendantsQuery([mockId(1), mockId(2), mockId(3)]);

			await expect(
				serviceCategory.updateStatus(
					entry,
					CategoryStatusEnum.INACTIVE,
				),
			).rejects.toThrow('category.error.has_active_descendants');
		});

		it('should cascade to the active descendants when forced', async () => {
			const entry = buildCategory({
				id: mockId(1),
				status: CategoryStatusEnum.ACTIVE,
				sort_order: 30,
			});

			const { scopedRepository, updateQueryBuilder } =
				mockDescendantsQuery([mockId(1), mockId(2), mockId(3)]);

			await serviceCategory.updateStatus(
				entry,
				CategoryStatusEnum.INACTIVE,
				true,
			);

			// The subject's own id is filtered out - it is saved below, not bulk-updated.
			expect(updateQueryBuilder.where).toHaveBeenCalledWith(
				'id IN (:...ids)',
				{ ids: [mockId(2), mockId(3)] },
			);
			// Cascaded rows leave their sibling group too, so they reset alongside.
			expect(updateQueryBuilder.set).toHaveBeenCalledWith({
				status: CategoryStatusEnum.INACTIVE,
				sort_order: 0,
			});
			expect(updateQueryBuilder.execute).toHaveBeenCalled();
			expect(entry.status).toBe(CategoryStatusEnum.INACTIVE);
			expect(entry.sort_order).toBe(0);
			expect(scopedRepository.save).toHaveBeenCalledWith(entry);
		});

		it('should skip the descendant lookup when the category is being activated', async () => {
			const entry = buildCategory({
				id: mockId(1),
				status: CategoryStatusEnum.INACTIVE,
				sort_order: 30,
			});

			const { scopedRepository, treeRepository } = mockDescendantsQuery(
				[],
			);

			await serviceCategory.updateStatus(
				entry,
				CategoryStatusEnum.ACTIVE,
			);

			expect(
				treeRepository.createDescendantsQueryBuilder,
			).not.toHaveBeenCalled();
			expect(entry.status).toBe(CategoryStatusEnum.ACTIVE);
			// Reactivating rejoins a group that may have been reordered meanwhile, so the
			// stored position is stale in this direction too.
			expect(entry.sort_order).toBe(0);
			expect(scopedRepository.save).toHaveBeenCalledWith(entry);
		});
	});

	/**
	 * A position is only meaningful among siblings, so a reorder addresses exactly one
	 * group - same type, same parent, or the roots of that type.
	 */
	describe('updateOrder - sibling group', () => {
		function mockSiblingGroup(siblings: CategoryEntity[]) {
			const queryBuilder = {
				where: jest.fn().mockReturnThis(),
				andWhere: jest.fn().mockReturnThis(),
				getMany: jest
					.fn<() => Promise<CategoryEntity[]>>()
					.mockResolvedValue(siblings),
			};

			const scopedRepository = {
				createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
				save: jest.fn<
					(entries: CategoryEntity[]) => Promise<CategoryEntity[]>
				>(),
			};

			const { transaction, manager } = setupTransactionMock();
			manager.getRepository.mockReturnValue(scopedRepository);

			return { transaction, scopedRepository, queryBuilder };
		}

		it('should assign descending positions across the group', async () => {
			const siblings = [
				buildCategory({ id: mockId(13), sort_order: 10 }),
				buildCategory({ id: mockId(14), sort_order: 20 }),
				buildCategory({ id: mockId(15), sort_order: 30 }),
			];

			const { transaction, scopedRepository } =
				mockSiblingGroup(siblings);

			await serviceCategory.updateOrder(
				CategoryTypeEnum.PRODUCT,
				mockId(9),
				[mockId(15), mockId(13), mockId(14)],
			);

			expect(transaction).toHaveBeenCalled();
			expect(
				siblings.map((sibling) => [sibling.id, sibling.sort_order]),
			).toEqual([
				[mockId(13), 2],
				[mockId(14), 1],
				[mockId(15), 3],
			]);
			expect(scopedRepository.save).toHaveBeenCalledWith(siblings);
		});

		it('should scope the group to a parent when one is given', async () => {
			const { queryBuilder } = mockSiblingGroup([
				buildCategory({ id: mockId(13) }),
				buildCategory({ id: mockId(14) }),
			]);

			await serviceCategory.updateOrder(
				CategoryTypeEnum.PRODUCT,
				mockId(9),
				[mockId(14), mockId(13)],
			);

			expect(queryBuilder.andWhere).toHaveBeenCalledWith(
				'category.parent_id = :parent_id',
				{ parent_id: mockId(9) },
			);
		});

		it('should scope the group to the roots when no parent is given', async () => {
			const { queryBuilder } = mockSiblingGroup([
				buildCategory({ id: mockId(9) }),
				buildCategory({ id: mockId(10) }),
			]);

			await serviceCategory.updateOrder(
				CategoryTypeEnum.PRODUCT,
				undefined,
				[mockId(10), mockId(9)],
			);

			expect(queryBuilder.andWhere).toHaveBeenCalledWith(
				'category.parent_id IS NULL',
			);
			// Product and article roots share a null parent, so the type has to narrow it.
			expect(queryBuilder.where).toHaveBeenCalledWith(
				'category.type = :type',
				{ type: CategoryTypeEnum.PRODUCT },
			);
		});

		it('should reject a subset of the group', async () => {
			const { scopedRepository } = mockSiblingGroup([
				buildCategory({ id: mockId(13) }),
				buildCategory({ id: mockId(14) }),
				buildCategory({ id: mockId(15) }),
			]);

			await expect(
				serviceCategory.updateOrder(
					CategoryTypeEnum.PRODUCT,
					mockId(9),
					[mockId(13), mockId(14)],
				),
			).rejects.toThrow('category.validation.invalid_ids_provided');

			expect(scopedRepository.save).not.toHaveBeenCalled();
		});

		it('should reject an id that belongs to another group', async () => {
			const { scopedRepository } = mockSiblingGroup([
				buildCategory({ id: mockId(13) }),
				buildCategory({ id: mockId(14) }),
			]);

			await expect(
				serviceCategory.updateOrder(
					CategoryTypeEnum.PRODUCT,
					mockId(9),
					[mockId(13), mockId(99)],
				),
			).rejects.toThrow('category.validation.invalid_ids_provided');

			expect(scopedRepository.save).not.toHaveBeenCalled();
		});
	});

	describe('delete - descendant guard', () => {
		it('should refuse to delete a category that still has live descendants', async () => {
			const category = buildCategory({ id: mockId(1), deleted_at: null });

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(category);
			mockTreeRepository([
				category,
				buildCategory({ id: mockId(2), deleted_at: null }),
			]);

			await expect(serviceCategory.delete(mockId(1))).rejects.toThrow(
				'category.error.has_descendants',
			);

			expect(mockCategory.query.delete).not.toHaveBeenCalled();
		});

		it('should ignore descendants that are already soft-deleted', async () => {
			const category = buildCategory({ id: mockId(1), deleted_at: null });

			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(category);
			mockTreeRepository([
				category,
				buildCategory({
					id: mockId(2),
					deleted_at: createCurrentDate(),
				}),
			]);
			mockCategory.query.delete.mockResolvedValue(1);

			await serviceCategory.delete(mockId(1));

			expect(mockCategory.query.filterById).toHaveBeenCalledWith(
				mockId(1),
			);
			expect(mockCategory.query.delete).toHaveBeenCalledWith();
		});

		it('should refuse to delete an already deleted category', async () => {
			jest.spyOn(serviceCategory, 'findById').mockResolvedValue(
				buildCategory({
					id: mockId(1),
					deleted_at: createCurrentDate(),
				}),
			);

			await expect(serviceCategory.delete(mockId(1))).rejects.toThrow(
				'category.error.already_deleted',
			);
		});
	});

	describe('restore - parent guards', () => {
		it('should refuse to restore a category that is not deleted', async () => {
			mockCategory.query.firstOrFail.mockResolvedValue(
				buildCategory({ id: mockId(1), deleted_at: null }),
			);

			await expect(serviceCategory.restore(mockId(1))).rejects.toThrow(
				'category.error.not_deleted',
			);
		});

		it('should refuse to restore under a deleted parent', async () => {
			mockCategory.query.firstOrFail.mockResolvedValue(
				buildCategory({
					id: mockId(1),
					deleted_at: createCurrentDate(),
					parent: buildCategory({
						id: mockId(2),
						deleted_at: createCurrentDate(),
					}),
				}),
			);

			await expect(serviceCategory.restore(mockId(1))).rejects.toThrow(
				'category.error.parent_deleted',
			);
		});

		it('should refuse to restore under an inactive parent', async () => {
			mockCategory.query.firstOrFail.mockResolvedValue(
				buildCategory({
					id: mockId(1),
					deleted_at: createCurrentDate(),
					parent: buildCategory({
						id: mockId(2),
						deleted_at: null,
						status: CategoryStatusEnum.INACTIVE,
					}),
				}),
			);

			await expect(serviceCategory.restore(mockId(1))).rejects.toThrow(
				'category.error.parent_not_active',
			);
		});
	});

	testServiceFindById<CategoryEntity, CategoryQuery>(
		mockCategory.query,
		serviceCategory,
	);

	testServiceFindByFilter<CategoryEntity, CategoryQuery, CategoryValidator>(
		mockCategory.query,
		serviceCategory,
		categoryInputPayloads.find,
	);

	/**
	 * The anonymous listing is defined by what a visitor *cannot* ask for: the schema carries
	 * no status or deleted filter, so the query has to pin both itself.
	 */
	describe('findByFilterPublic - published scope', () => {
		const publicFindData = categoryOutputPayloads.publicFind;

		it('should pin the status to active and never widen to deleted rows', async () => {
			mockCategory.query.all.mockResolvedValue([[], 0]);

			const result =
				await serviceCategory.findByFilterPublic(publicFindData);

			expect(mockCategory.query.filterBy).toHaveBeenCalledWith(
				'status',
				CategoryStatusEnum.ACTIVE,
			);
			expect(mockCategory.query.withDeleted).not.toHaveBeenCalled();
			expect(result).toEqual([[], 0]);
		});

		it('should scope to the roots when is_root is set', async () => {
			mockCategory.query.all.mockResolvedValue([[], 0]);

			await serviceCategory.findByFilterPublic({
				...publicFindData,
				filter: { ...publicFindData.filter, is_root: true },
			});

			expect(mockCategory.queryBuilder.andWhere).toHaveBeenCalledWith(
				'category.parent_id IS NULL',
			);
		});
	});

	it('should delete by id', async () => {
		jest.spyOn(serviceCategory, 'findById').mockResolvedValue({
			...getCategoryEntityMock(),
			deleted_at: null,
		});
		mockCategory.query.delete.mockResolvedValue(1);

		mockTreeRepository([getCategoryEntityMock()]);

		await serviceCategory.delete(mockId(1));

		expect(mockCategory.query.delete).toHaveBeenCalledWith();
	});

	it('should restore by id', async () => {
		mockCategory.query.firstOrFail.mockResolvedValue({
			...getCategoryEntityMock(),
			deleted_at: createCurrentDate(),
			parent: null,
		});
		mockCategory.query.restore.mockReturnThis();

		await serviceCategory.restore(mockId(1));

		expect(mockCategory.query.filterById).toHaveBeenCalledWith(mockId(1));
		expect(mockCategory.query.restore).toHaveBeenCalledWith();
	});
});
