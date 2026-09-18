import { expect, jest } from '@jest/globals';
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export function createMockQuery() {
	return {
		// Chainable methods
		select: jest.fn().mockReturnThis(),
		addSelect: jest.fn().mockReturnThis(),
		join: jest.fn().mockReturnThis(),
		joinAndSelect: jest.fn().mockReturnThis(),
		filterBy: jest.fn().mockReturnThis(),
		filterById: jest.fn().mockReturnThis(),
		filterByRange: jest.fn().mockReturnThis(),
		filterByTerm: jest.fn().mockReturnThis(),
		filterPublished: jest.fn().mockReturnThis(),
		filterBySellable: jest.fn().mockReturnThis(),
		filterByStatus: jest.fn().mockReturnThis(),
		filterByEmail: jest.fn().mockReturnThis(),
		filterByIdent: jest.fn().mockReturnThis(),
		filterByBoolean: jest.fn().mockReturnThis(),
		orderBy: jest.fn().mockReturnThis(),
		pagination: jest.fn().mockReturnThis(),
		withDeleted: jest.fn().mockReturnThis(),

		// Methods from RepositoryAbstract
		filterAny: jest.fn().mockReturnThis(),
		filterRaw: jest.fn().mockReturnThis(),
		/*
		 * The escape hatch to the underlying TypeORM builder, for a condition no `filterBy`
		 * can express (`parent_id IS NULL`). `createMockRepository` points it at the same
		 * builder stub it hands to the repository, so a test can assert on `andWhere`;
		 * standalone callers get an inert one.
		 */
		getQuery: jest.fn(),

		// Execute methods
		save: jest.fn(),
		delete: jest.fn(),
		restore: jest.fn(),
		firstOrFail: jest.fn(),
		first: jest.fn(),
		firstRaw: jest.fn(),
		all: jest.fn(),
		count: jest.fn(),
	};
}

export function createMockRepository<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
>() {
	const mockQuery = createMockQuery();
	const query = mockQuery as unknown as jest.Mocked<Q>;

	const createQueryMock = jest.fn(() => {
		return query;
	});

	// Chainable TypeORM query-builder stub. Every filter method returns the builder, so a
	// service can chain freely; a test only has to configure the terminal call it needs
	// (`getMany`/`getOne`), which default to empty results.
	const queryBuilder = {
		// Typed with their real arguments, so a test can assert on the condition that was
		// built rather than only on the call happening.
		where: jest.fn(
			(_condition?: string, _parameters?: object) => queryBuilder,
		),
		andWhere: jest.fn(
			(_condition?: string, _parameters?: object) => queryBuilder,
		),
		orderBy: jest.fn(() => queryBuilder),
		addOrderBy: jest.fn(() => queryBuilder),
		select: jest.fn(() => queryBuilder),
		leftJoinAndSelect: jest.fn(() => queryBuilder),
		getMany: jest.fn(async () => [] as E[]),
		getOne: jest.fn(async () => null as E | null),
	};

	mockQuery.getQuery.mockReturnValue(queryBuilder);

	const repository = {
		createQuery: createQueryMock,
		createQueryBuilder: jest.fn(() => queryBuilder),
		// TypeORM's entity factory, which a service calls before `save` when it has to run
		// checks against the row as it will be stored. It only ever builds the object, so
		// echoing the input back is what it does.
		create: jest.fn((entityLike: unknown) => entityLike),
		save: jest.fn(),
		update: jest.fn(),
		softDelete: jest.fn(),
		find: jest.fn(async () => [] as E[]),
		count: jest.fn(async () => 0),
	} as unknown as jest.Mocked<Repository<E>> & {
		createQuery(): Q;
	};

	return {
		query,
		queryBuilder,
		repository,
	};
}

export function createMockContentRepository<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
>() {
	const query = createMockQuery() as unknown as jest.Mocked<Q>;

	const createQueryMock = jest.fn(() => {
		return query;
	});

	const repository = {
		createQuery: createQueryMock,
		save: jest.fn(),
		saveContent: jest.fn(),
	};

	return {
		query,
		repository,
	};
}

/**
 * Stubs `dataSource.transaction` so the callback runs against a fake `EntityManager`.
 *
 * Pass the repository from `createMockRepository()` when the service under test resolves
 * one inside the transaction (`manager.getRepository(Entity)`) - without it `getRepository`
 * returns `undefined` and the service dies on the first call against it.
 */
export function setupTransactionMock(repository?: unknown) {
	const manager = {
		query: jest.fn(),
		save: jest.fn(),
		softRemove: jest.fn(),
		// Deliberately loose: a test may override this with a bespoke repository stub
		// (see `BrandService.updateOrder`), which is not a full TypeORM `Repository`.
		getRepository: jest.fn(() => repository) as jest.Mock,
	};

	const transaction = jest
		.spyOn(dataSource, 'transaction')
		.mockImplementation(
			async <T>(
				isolationOrCb:
					| ((manager: EntityManager) => Promise<T>)
					| string,
				maybeCb?: (manager: EntityManager) => Promise<T>,
			): Promise<T> => {
				if (typeof isolationOrCb === 'function') {
					return isolationOrCb(manager as unknown as EntityManager);
				} else {
					if (!maybeCb) {
						throw new Error(
							'Callback is required when isolation level is provided',
						);
					}
					return maybeCb(manager as unknown as EntityManager);
				}
			},
		);

	return { transaction, manager };
}

interface IUpdateService<E> {
	update(data: Partial<E> & { id: number }): Promise<Partial<E>>;
}

export function testServiceUpdate<E extends ObjectLiteral>(
	service: IUpdateService<E>,
	repository: jest.Mocked<Repository<E>>,
	saveData: E & { id: number },
) {
	it('should update', async () => {
		repository.save.mockResolvedValue(saveData);

		await service.update(saveData);

		expect(repository.save).toHaveBeenCalled();
	});
}

interface IUpdateStatusService<E, S> {
	updateStatus(entry: E, newStatus: S): Promise<void>;
}

export function testServiceUpdateStatus<
	E extends ObjectLiteral,
	S extends string,
>(
	service: IUpdateStatusService<E, S>,
	repository: jest.Mocked<Repository<E>>,
	statusTransitions: {
		good: { from: S; to: S };
		bad?: { from: S; to: S };
	},
) {
	it('updateStatus - status_unchanged', async () => {
		const entity = {
			id: 1,
			status: statusTransitions.good.from,
		} as unknown as E;

		await expect(
			service.updateStatus(entity, statusTransitions.good.from),
		).rejects.toThrow('shared.error.status_unchanged');
	});

	if (statusTransitions.bad !== undefined) {
		const badTransition = statusTransitions.bad;

		it('updateStatus - status_update_not_allowed', async () => {
			const entity = {
				id: 1,
				status: badTransition.from,
			} as unknown as E;

			await expect(
				service.updateStatus(entity, badTransition.to),
			).rejects.toThrow('shared.error.status_update_not_allowed');
		});
	}

	it('updateStatus - success', async () => {
		const entity = {
			id: 1,
			status: statusTransitions.good.from,
		} as unknown as E;

		repository.save.mockResolvedValue(entity);

		await service.updateStatus(entity, statusTransitions.good.to);

		expect(repository.save).toHaveBeenCalled();
	});
}

interface IDeleteService {
	delete(id: number): Promise<void>;
}

export function testServiceDelete<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
>(
	query: jest.Mocked<Q>,
	service: IDeleteService,
	// Most services soft-delete via a bare `.delete()`. Pass the arguments when a feature
	// deliberately differs - `image` hard-deletes with `.delete(false)`, since a
	// soft-deleted row whose file is gone is useless.
	expectedDeleteArgs: boolean[] = [],
) {
	it('should delete by id', async () => {
		query.delete.mockResolvedValue(1);

		await service.delete(1);

		expect(query.filterById).toHaveBeenCalledWith(1);
		expect(query.delete).toHaveBeenCalledWith(...expectedDeleteArgs);
	});
}

interface IDeleteMultipleService {
	delete(data: { ids: number[] }): Promise<number>;
}

export function testServiceDeleteMultiple<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
>(
	query: jest.Mocked<Q>,
	service: IDeleteMultipleService,
	deleteData: { ids: number[] },
) {
	it('should delete by ids', async () => {
		query.delete.mockResolvedValue(3);

		const result = await service.delete(deleteData);

		expect(query.delete).toHaveBeenCalledWith(false, true, true);
		expect(result).toBe(3);
	});
}

interface IRestoreService {
	restore(id: number): Promise<void>;
}

export function testServiceRestore<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
>(query: jest.Mocked<Q>, service: IRestoreService, entry?: E) {
	it('should restore by id', async () => {
		/*
		 * A restore is not always a bare `filterById().restore()`. Where a unique index is
		 * partial on `deleted_at IS NULL`, deleting a row frees its key for someone else, so
		 * the service reloads the row and refuses when the key was taken meanwhile - see
		 * `BrandService.restore`. Both halves of that are arranged here: the row exists, and
		 * nothing else holds its key.
		 *
		 * Arranged in the helper rather than left to each caller because `clearMocks` resets
		 * calls but not implementations, so otherwise this test passes or fails on whatever
		 * earlier tests in the file happened to leave on `firstOrFail` and `first` - it read
		 * as a brand bug while being an ordering artefact, and failed differently when run
		 * alone. A service that checks nothing is unaffected by either line.
		 */
		query.firstOrFail.mockResolvedValue(
			entry ?? ({ id: 1 } as unknown as E),
		);
		query.first.mockResolvedValue(null);
		query.restore.mockReturnThis();

		await service.restore(1);

		expect(query.filterById).toHaveBeenCalledWith(1);
		expect(query.restore).toHaveBeenCalledWith();
	});
}

interface IFindByIdService<E extends ObjectLiteral> {
	findById(id: number, withDeleted: boolean): Promise<E>;
}

export function testServiceFindById<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
>(query: jest.Mocked<Q>, service: IFindByIdService<E>) {
	it('should find entity by id', async () => {
		const entity = { id: 1 };

		query.firstOrFail.mockResolvedValue(entity);

		const result = await service.findById(entity.id, true);

		expect(query.filterById).toHaveBeenCalledWith(entity.id);
		expect(query.firstOrFail).toHaveBeenCalled();
		expect(result).toBe(entity);
	});
}

interface IFindByFilterService<
	E extends ObjectLiteral,
	V extends Record<'find', unknown>,
> {
	findByFilter(
		filter: ValidatorOutput<V, 'find'>,
		withDeleted?: boolean,
	): Promise<[E[], number] | E[]>;
}

export function testServiceFindByFilter<
	E extends ObjectLiteral,
	Q extends RepositoryAbstract<E>,
	V extends Record<'find', unknown>,
>(
	query: jest.Mocked<Q>,
	service: IFindByFilterService<E, V>,
	findData: ValidatorOutput<V, 'find'>,
) {
	it('should apply filters and return paginated results', async () => {
		query.all.mockResolvedValue([[], 0]);

		const result = await service.findByFilter(findData);

		expect(query.all).toHaveBeenCalledWith(true);
		expect(result).toEqual([[], 0]);
	});
}
