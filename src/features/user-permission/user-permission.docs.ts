import { Configuration } from '@/config/settings.config';
import type { userPermissionController } from '@/features/user-permission/user-permission.controller';
import {
	getUserPermissionEntityMock,
	userPermissionInputPayloads,
} from '@/features/user-permission/user-permission.mock';
import { OrderByEnum } from '@/features/user-permission/user-permission.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getUserPermissionEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * Which permissions a user holds. A row here joins a user to a `permission` row; the permission
 * itself grants nothing until one of these exists.
 *
 * Gated by the **`permission`** entity, not by `user` and not by an entity of its own: `create`
 * needs `permission` create, `delete` and `restore` need `permission` delete, `find` needs
 * `permission` find. Granting someone the ability to hand out permissions is the same decision as
 * letting them define one - which is also why these live on their own base path rather than under
 * `/users`, whose module answers to a different entity.
 *
 * Every write drops the target user's cached entry, because the permission set is baked into what
 * the auth middleware reads - so a grant or revocation takes effect on that user's next request
 * rather than when their token next expires.
 */

const userIdParam = {
	type: 'number' as const,
	required: true,
	condition: 'uuid; a malformed value answers 400, not 422',
};

export const docs: Record<
	keyof typeof userPermissionController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Grant permissions to a user',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Grant result, one entry per requested permission',
			dataSample: [
				{ permission_id: 1, message: 'User permission created' },
				{ permission_id: 2, message: 'User permission already exists' },
			] as unknown as Record<string, unknown>,
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: 'Takes a batch and never fails on one of it: `data` is the bare array of outcomes, one per requested id, saying whether the grant was created, restored from a soft delete, or already held. The response is a 200 even when every entry was a duplicate, so read the entries rather than the status. The user is named twice - the path segment is only checked for shape, while the `user_id` in the body is the one the grant is written against, and a request whose two disagree follows the body',
			params: {
				user_id: userIdParam,
			},
			body: {
				user_id: {
					type: 'string',
					required: true,
					condition: 'the account the permissions are granted to',
				},
				permission_ids: {
					type: 'array',
					required: true,
					format: 'number[]',
					condition: 'at least one id, each a uuid',
				},
			},
			sample: userPermissionInputPayloads.create,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Revoke a permission from a user',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'User permission deleted',
		},
		withAuthErrors: true,
		withErrors: [400, 404],
		request: {
			notes: 'Addressed by the `permission` id, not by the id of the grant row - the pair is what a caller knows, and `restore` takes the same one. Soft delete, so the row survives and `restore` can hand the permission back; granting the same permission again through `create` also revives it rather than inserting a second row. A pair that is not granted, or is already revoked, answers 404',
			params: {
				user_id: userIdParam,
				permission_id: {
					type: 'string',
					required: true,
					condition:
						'the permission being revoked, not the grant row',
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore a revoked permission grant',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'User permission restored',
		},
		withAuthErrors: true,
		withErrors: [400, 404],
		request: {
			notes: 'Takes the same pair `delete` does, so a grant is revoked and restored by one address. Idempotent: a pair that is currently granted is restored to the state it already has and answers 200, and only a pair with no row at all - granted or revoked - answers 404. Listing the revoked grants through `find` needs the `permission` delete permission, which is the same one this action needs',
			params: {
				user_id: userIdParam,
				permission_id: {
					type: 'string',
					required: true,
					condition: 'the permission being restored',
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'List the permissions granted to a user',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'User permission list',
			dataSample: {
				entries: [entitySample],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					user_id: 1,
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.ASC,
					limit: 5,
					page: 1,
					filter: {
						entity: 'user',
						operation: 'create',
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: `An entry carries the pair only - \`permission_id\`, not the entity and operation behind it - so a caller rendering names reads them from \`GET /permissions\`. The \`entity\` and \`operation\` filters and the \`${OrderByEnum.ENTITY}\` / \`${OrderByEnum.OPERATION}\` sorts still reach those columns: they are applied over a join the response does not carry`,
			params: {
				user_id: userIdParam,
			},
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
					entity: {
						type: 'string',
						required: false,
						condition: `partial match on the permission entity, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					operation: {
						type: 'string',
						required: false,
						condition: `partial match on the permission operation, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only takes effect for a caller holding permission delete',
					},
				},
			},
			sample: userPermissionInputPayloads.find,
		},
	}),
};
