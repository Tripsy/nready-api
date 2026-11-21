import type PermissionEntity from '@/features/permission/permission.entity';
import {
	OrderByEnum,
	PermissionValidator,
} from '@/features/permission/permission.validator';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const permissionValidator = new PermissionValidator('permission');

export function getPermissionEntityMock(): PermissionEntity {
	return {
		id: mockId(1),
		entity: 'user',
		operation: 'create',
		deleted_at: null,
	};
}

export const permissionInputPayloads = {
	create: {
		entity: 'user',
		operation: 'create',
	},
	update: {
		id: mockId(1),
		entity: 'user',
		operation: 'create',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'user',
			is_deleted: false,
		},
	},
};

export const permissionOutputPayloads = {
	create: permissionValidator.create.parse(permissionInputPayloads.create),
	update: permissionValidator.update.parse(permissionInputPayloads.update),
	find: permissionValidator.find.parse(permissionInputPayloads.find),
};
