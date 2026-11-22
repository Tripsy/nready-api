import type UserPermissionEntity from '@/features/user-permission/user-permission.entity';
import {
	OrderByEnum,
	UserPermissionValidator,
} from '@/features/user-permission/user-permission.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const userPermissionValidator = new UserPermissionValidator('user-permission');

export function getUserPermissionEntityMock(): UserPermissionEntity {
	return {
		id: mockId(1),
		user_id: mockId(1),
		permission_id: mockId(1),
		created_at: createPastDate(86400),
		deleted_at: null,
	};
}

export const userPermissionInputPayloads = {
	create: {
		user_id: mockId(1),
		permission_ids: [mockId(1), mockId(2)],
	},
	find: {
		user_id: mockId(1),
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			entity: 'user',
			operation: 'create',
			is_deleted: false,
		},
	},
};

export const userPermissionOutputPayloads = {
	create: userPermissionValidator.create.parse(
		userPermissionInputPayloads.create,
	),
	find: userPermissionValidator.find.parse(userPermissionInputPayloads.find),
};
