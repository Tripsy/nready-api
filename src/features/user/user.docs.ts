import { Configuration } from '@/config/settings.config';
import type { userController } from '@/features/user/user.controller';
import {
	STATUS_TRANSITIONS,
	UserOperatorTypeEnum,
	UserStatusEnum,
} from '@/features/user/user.entity';
import {
	getUserEntityMock,
	userInputPayloads,
} from '@/features/user/user.mock';
import { OrderByEnum } from '@/features/user/user.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { UserRoleEnum } from '@/shared/types/user-role.type';

/**
 * `password` is declared `select: false` on the entity, so no read path ever returns it -
 * the mock only carries one because it types as the full `UserEntity`. Stripped here so the
 * documented response matches what a caller actually receives.
 */
function getUserResponseSample(): Record<string, unknown> {
	const { password: _password, ...user } = getUserEntityMock();

	return user as unknown as Record<string, unknown>;
}

/** Rendered as `pending -> active | inactive`, so the allowed moves are readable at a glance. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

const roleNote =
	'operator_type is required when role is operator, and must be omitted otherwise';

export const docs: Record<keyof typeof userController, ApiInputDocumentation> =
	{
		create: helperApiInputDocumentation({
			description: 'Create a new user',
			withBearerAuth: true,
			success: {
				status: 201,
				description: 'User created successfully',
				dataSample: getUserResponseSample(),
			},
			withAuthErrors: true,
			withErrors: [400, 422],
			request: {
				notes: `password_confirm must match password; ${roleNote}`,
				body: {
					name: {
						type: 'string',
						required: true,
						condition: `at least ${Configuration.get('user.nameMinChars')} characters`,
					},
					email: { type: 'string', format: 'email', required: true },
					password: {
						type: 'string',
						required: true,
						condition: `at least ${Configuration.get('user.passwordMinChars')} characters, with a capital letter, a number and a special character`,
					},
					password_confirm: { type: 'string', required: true },
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(UserStatusEnum),
						default: UserStatusEnum.PENDING,
					},
					role: {
						type: 'enum',
						required: false,
						values: Object.values(UserRoleEnum),
						default: UserRoleEnum.MEMBER,
					},
					operator_type: {
						type: 'enum',
						required: false,
						values: Object.values(UserOperatorTypeEnum),
						condition: 'only when role is operator',
					},
				},
				sample: userInputPayloads.create,
			},
		}),
		read: helperApiInputDocumentation({
			description: 'Get user details',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'User details',
				dataSample: getUserResponseSample(),
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
			},
		}),
		update: helperApiInputDocumentation({
			description: 'Update user',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'User updated successfully',
				dataSample: getUserResponseSample(),
			},
			withAuthErrors: true,
			withErrors: [400, 404, 422],
			request: {
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
				notes: `Provide at least one body parameter; password_confirm must match password when a password is sent; ${roleNote}`,
				body: {
					name: {
						type: 'string',
						required: false,
						condition: `at least ${Configuration.get('user.nameMinChars')} characters`,
					},
					email: { type: 'string', format: 'email', required: false },
					password: {
						type: 'string',
						required: false,
						condition: `at least ${Configuration.get('user.passwordMinChars')} characters, with a capital letter, a number and a special character`,
					},
					password_confirm: {
						type: 'string',
						required: false,
						condition: 'required when password is sent',
					},
					language: {
						type: 'enum',
						required: false,
						values: Configuration.get('language.supported'),
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(UserStatusEnum),
					},
					role: {
						type: 'enum',
						required: false,
						values: Object.values(UserRoleEnum),
					},
					operator_type: {
						type: 'enum',
						required: false,
						values: Object.values(UserOperatorTypeEnum),
						condition: 'only when role is operator',
					},
				},
				sample: userInputPayloads.update,
			},
		}),
		delete: helperApiInputDocumentation({
			description: 'Delete user',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'User deleted with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
			},
		}),
		restore: helperApiInputDocumentation({
			description: 'Restore user',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'User restored with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
			},
		}),
		statusUpdate: helperApiInputDocumentation({
			description: 'Move a user to another status',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'User status updated with success',
				dataSample: getUserResponseSample(),
			},
			withAuthErrors: true,
			withErrors: [404, 422],
			request: {
				notes: `Only these transitions are allowed: ${statusTransitionNote}`,
				params: {
					id: {
						type: 'string',
						required: true,
					},
					status: {
						type: 'enum',
						required: true,
						values: Object.values(UserStatusEnum),
					},
				},
			},
		}),
		find: helperApiInputDocumentation({
			description: 'Get users',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'User list',
				dataSample: {
					entries: [],
					pagination: {
						page: 1,
						limit: 5,
						total: 0,
					},
					query: {
						order_by: 'id',
						direction: 'DESC',
						limit: 5,
						page: 1,
						filter: {
							term: 'zone.ro',
							is_deleted: true,
						},
					},
				},
			},
			withAuthErrors: true,
			request: {
				notes: 'create_at_start must not be after create_at_end',
				query: {
					page: {
						type: 'number',
						required: false,
						default: 1,
					},
					limit: {
						type: 'number',
						required: false,
						default: Configuration.get('filter.limit'),
					},
					order_by: {
						type: 'enum',
						required: false,
						values: Object.values(OrderByEnum),
						default: OrderByEnum.ID,
					},
					direction: {
						type: 'enum',
						required: false,
						values: Object.values(OrderDirectionEnum),
						default: OrderDirectionEnum.ASC,
					},
					filter: {
						id: {
							type: 'string',
							required: false,
						},
						term: {
							type: 'string',
							required: false,
							condition: `at least ${Configuration.get('filter.termMinLength')} characters`,
						},
						status: {
							type: 'enum',
							required: false,
							values: Object.values(UserStatusEnum),
						},
						role: {
							type: 'enum',
							required: false,
							values: Object.values(UserRoleEnum),
						},
						create_at_start: {
							type: 'string',
							format: 'date-time',
							required: false,
						},
						create_at_end: {
							type: 'string',
							format: 'date-time',
							required: false,
						},
						is_deleted: {
							type: 'boolean',
							required: false,
							default: false,
						},
					},
				},
				sample: userInputPayloads.find,
			},
		}),
	};
