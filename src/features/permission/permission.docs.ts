import { Configuration } from '@/config/settings.config';
import type { permissionController } from '@/features/permission/permission.controller';
import {
	getPermissionEntityMock,
	permissionInputPayloads,
} from '@/features/permission/permission.mock';
import { OrderByEnum } from '@/features/permission/permission.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getPermissionEntityMock() as unknown as Record<
	string,
	unknown
>;

const pairNote =
	'entity and operation are unique together among the rows that are not deleted - a soft-deleted permission releases the pair, and restoring it fails while another row holds the same one';

const entityParam = {
	type: 'string' as const,
	required: true,
	condition:
		'the name the access check asks for, so a value no code checks is stored and never read',
};

const operationParam = {
	type: 'string' as const,
	required: true,
	condition:
		'create, read, update, find or delete; delete also covers restore and is what reveals soft-deleted rows of that entity',
};

/**
 * A row here grants nothing on its own - it becomes access only once `user-permission` assigns it
 * to a user, which is also the write that clears that user's cached permission set. Deleting a
 * permission takes it away from everyone holding it without touching the grants, because the
 * lookup joins this table and skips deleted rows.
 */
export const docs: Record<
	keyof typeof permissionController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new permission',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Permission created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: `${pairNote}. A pair that exists and is deleted is restored instead of created for a caller holding permission delete, and answers 409 for anyone else`,
			body: {
				entity: entityParam,
				operation: operationParam,
			},
			sample: permissionInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get permission details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Permission details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'A deleted permission is only visible to a caller holding permission delete',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update permission',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Permission updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Both parameters are required - this is a full replacement of the pair, not a partial edit. ${pairNote}, so the new pair is re-checked against the other permissions`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				entity: entityParam,
				operation: operationParam,
			},
			sample: permissionInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete permission',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Permission deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Soft delete. Every user holding this permission loses it, while the grants themselves are left in place - restoring the row hands it back to all of them',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore permission',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Permission restored with success',
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
	find: helperApiInputDocumentation({
		description: 'Get permissions',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Permission list',
			dataSample: {
				entries: [entitySample],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.ASC,
					limit: 5,
					page: 1,
					filter: {
						term: 'user',
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
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
					id: { type: 'string', required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise entity and operation, from ${Configuration.get('filter.termMinLength')} characters`,
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
			sample: permissionInputPayloads.find,
		},
	}),
};
