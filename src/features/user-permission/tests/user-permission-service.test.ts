import { expect, jest } from '@jest/globals';
import type { ObjectLiteral, Repository } from 'typeorm';
import type UserPermissionEntity from '@/features/user-permission/user-permission.entity';
import {
	getUserPermissionEntityMock,
	userPermissionInputPayloads,
	userPermissionOutputPayloads,
} from '@/features/user-permission/user-permission.mock';
import type { UserPermissionQuery } from '@/features/user-permission/user-permission.repository';
import { UserPermissionService } from '@/features/user-permission/user-permission.service';
import { createCurrentDate } from '@/helpers/date.helper';
import type RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import { createMockQuery } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

function createMockRepositoryForUserPermission<
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
		getUserPermissions: jest.fn(),
	} as unknown as jest.Mocked<Repository<E>> & {
		createQuery(): Q;
		getUserPermissions: jest.MockedFunction<
			// biome-ignore lint/suspicious/noExplicitAny: getUserPermissions return a [] of data which use join and is typed as any
			(user_id: EntityId) => Promise<any[]>
		>;
	};

	return {
		query,
		repository,
	};
}

describe('UserPermissionService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockUserPermission = createMockRepositoryForUserPermission<
		UserPermissionEntity,
		UserPermissionQuery
	>();

	const serviceUserPermission = new UserPermissionService(
		mockUserPermission.repository,
	);

	it('should create new user permissions', async () => {
		mockUserPermission.query.first.mockResolvedValue(null);
		mockUserPermission.repository.save.mockResolvedValue(
			getUserPermissionEntityMock(),
		);

		const result = await serviceUserPermission.create(
			userPermissionOutputPayloads.create,
		);

		expect(result).toHaveLength(2);
		expect(mockUserPermission.repository.save).toHaveBeenCalledTimes(2);
	});

	it('should restore when existing is deleted', async () => {
		mockUserPermission.query.first
			.mockResolvedValueOnce({
				id: mockId(1),
				deleted_at: createCurrentDate(),
			} as UserPermissionEntity)
			.mockResolvedValueOnce(null);

		mockUserPermission.repository.restore = jest.fn();

		const result = await serviceUserPermission.create(
			userPermissionInputPayloads.create,
		);

		expect(mockUserPermission.repository.restore).toHaveBeenCalledWith(
			mockId(1),
		);
		expect(result).toHaveLength(2);
	});

	it('should delete by user_id and permission_id', async () => {
		mockUserPermission.query.delete.mockResolvedValue(1);

		await serviceUserPermission.delete(mockId(1), mockId(2));

		expect(mockUserPermission.query.filterBy).toHaveBeenCalledWith(
			'user_id',
			mockId(1),
		);

		expect(mockUserPermission.query.filterBy).toHaveBeenCalledWith(
			'permission_id',
			mockId(2),
		);

		expect(mockUserPermission.query.delete).toHaveBeenCalledWith(
			true,
			false,
			true,
		);
	});

	it('should restore by user_id and permission_id', async () => {
		mockUserPermission.query.restore.mockReturnThis();

		await serviceUserPermission.restore(mockId(1), mockId(2));

		expect(mockUserPermission.query.filterBy).toHaveBeenCalledWith(
			'user_id',
			mockId(1),
		);
		expect(mockUserPermission.query.filterBy).toHaveBeenCalledWith(
			'permission_id',
			mockId(2),
		);
		expect(mockUserPermission.query.restore).toHaveBeenCalledWith();
	});

	it('should apply filters and return paginated results', async () => {
		mockUserPermission.query.all.mockResolvedValue([[], 0]);

		const result = await serviceUserPermission.findByFilter(
			userPermissionInputPayloads.find,
			false,
			mockId(1),
		);

		expect(mockUserPermission.query.filterBy).toHaveBeenCalledWith(
			'user_id',
			mockId(1),
		);
		expect(mockUserPermission.query.all).toHaveBeenCalledWith(true);
		expect(result).toEqual([[], 0]);
	});
});
