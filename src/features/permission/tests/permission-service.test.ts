import { expect, jest } from '@jest/globals';
import type PermissionEntity from '@/features/permission/permission.entity';
import {
	getPermissionEntityMock,
	permissionInputPayloads,
	permissionOutputPayloads,
} from '@/features/permission/permission.mock';
import type { PermissionQuery } from '@/features/permission/permission.repository';
import { PermissionService } from '@/features/permission/permission.service';
import type { PermissionValidator } from '@/features/permission/permission.validator';
import { createCurrentDate } from '@/helpers/date.helper';
import {
	createMockRepository,
	testServiceDelete,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceRestore,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

describe('PermissionService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockPermission = createMockRepository<
		PermissionEntity,
		PermissionQuery
	>();

	const servicePermission = new PermissionService(mockPermission.repository);

	it('should create entry', async () => {
		const entity = getPermissionEntityMock();
		const createData = permissionOutputPayloads.create;

		mockPermission.query.first.mockResolvedValue(null);
		mockPermission.repository.save.mockResolvedValue(entity);

		const result = await servicePermission.create(createData, false);

		expect(result).toHaveProperty('permission', entity);
		expect(result).toHaveProperty('action', 'create');
	});

	it('should restore when creating with deleted existing', async () => {
		const entity = {
			...getPermissionEntityMock(),
			deleted_at: createCurrentDate(),
		};
		const createData = permissionOutputPayloads.create;

		mockPermission.query.first.mockResolvedValue(entity);
		mockPermission.query.restore.mockReturnThis();

		// `withDeleted: true` is what selects the restore branch; with `false` the service
		// rejects a soft-deleted duplicate with a 409 instead.
		const result = await servicePermission.create(createData, true);

		expect(result.action).toBe('restore');
		expect(mockPermission.query.restore).toHaveBeenCalled();
	});

	it('should updateData', async () => {
		const entry = getPermissionEntityMock();
		const updateData = permissionOutputPayloads.update;

		mockPermission.query.first.mockResolvedValue(null);
		mockPermission.repository.save.mockResolvedValue(entry);

		const result = await servicePermission.updateData(entry, updateData);

		expect(mockPermission.repository.save).toHaveBeenCalledWith(
			expect.objectContaining({
				id: mockId(1),
				entity: 'user',
				operation: 'create',
			}),
		);
		expect(result).toBe(entry);
	});

	testServiceFindById<PermissionEntity, PermissionQuery>(
		mockPermission.query,
		servicePermission,
	);

	testServiceFindByFilter<
		PermissionEntity,
		PermissionQuery,
		PermissionValidator
	>(mockPermission.query, servicePermission, permissionInputPayloads.find);

	testServiceDelete<PermissionEntity, PermissionQuery>(
		mockPermission.query,
		servicePermission,
	);

	testServiceRestore<PermissionEntity, PermissionQuery>(
		mockPermission.query,
		servicePermission,
	);
});
