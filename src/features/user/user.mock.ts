import type UserEntity from '@/features/user/user.entity';
import { UserStatusEnum } from '@/features/user/user.entity';
import { OrderByEnum, userValidator } from '@/features/user/user.validator';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { UserRoleEnum } from '@/shared/types/user-role.type';
import { mockId } from '@/tests/mocks/uuid.mock';

export function getUserEntityMock(): UserEntity {
	return {
		id: mockId(1),
		name: 'John Doe',
		email: 'john.doe@example.com',
		email_verified_at: null,
		password: 'hashed_password',
		password_updated_at: createPastDate(86400),
		language: 'en',
		status: UserStatusEnum.INACTIVE,
		role: UserRoleEnum.MEMBER,
		operator_type: null,
		created_at: createPastDate(28800),
		updated_at: null,
		deleted_at: null,
	};
}

export const userInputPayloads = {
	create: {
		name: 'John Doe',
		email: 'john.doe@example.com',
		password: 'Secure@123',
		password_confirm: 'Secure@123',
		language: 'en',
		status: UserStatusEnum.PENDING, // optional, default anyway
		role: UserRoleEnum.MEMBER, // optional, default anyway
		operator_type: null, // correct for non-operator
	},
	update: {
		id: mockId(1),
		name: 'Updated User',
		email: 'updated.user@example.com',
		password: 'Secure@123',
		password_confirm: 'Secure@123',
		language: 'en',
		status: UserStatusEnum.PENDING, // optional, default anyway
		role: UserRoleEnum.MEMBER, // optional, default anyway
		operator_type: null, // correct for non-operator
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'test',
			status: UserStatusEnum.ACTIVE,
			role: UserRoleEnum.MEMBER,
			create_at_start: formatDate(createPastDate(14400)),
			create_at_end: formatDate(createPastDate(7200)),
			is_deleted: true,
		},
	},
};

export const userOutputPayloads = {
	create: userValidator.create.parse(userInputPayloads.create),
	update: userValidator.update.parse(userInputPayloads.update),
	find: userValidator.find.parse(userInputPayloads.find),
};
