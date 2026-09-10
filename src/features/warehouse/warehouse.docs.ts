import { Configuration } from '@/config/settings.config';
import type { warehouseController } from '@/features/warehouse/warehouse.controller';
import {
	STATUS_TRANSITIONS,
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';
import { OrderByEnum } from '@/features/warehouse/warehouse.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Written out rather than taken from a `warehouse.mock.ts`, which this feature does not have.
 * `read` and `find` both join the address, so the sample carries it - the id alone is not what
 * either endpoint returns.
 */
const entitySample: Record<string, unknown> = {
	id: 1,
	address_id: 4,
	code: 'BUC-01',
	name: 'Bucharest Central',
	status: WarehouseStatusEnum.ACTIVE,
	is_default: true,
	notes: null,
	created_at: '2026-08-20T09:14:00.000Z',
	updated_at: null,
	deleted_at: null,
	address: {
		id: 4,
		city_id: 12,
		details: 'Strada Depozitelor 104',
		postal_code: '030114',
	},
};

/** Rendered as `active -> inactive`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

const defaultNote =
	'At most one warehouse is the default. Setting `is_default` here clears it on whichever warehouse held it, in the same transaction';

/**
 * A warehouse is where stock is held and, just as importantly, the origin an order ships from -
 * which is why a business that tracks no stock at all still has one.
 *
 * `status` is never part of a create or an update body - it moves only through its own route, and
 * only along the transitions the entity declares.
 */
export const docs: Record<
	keyof typeof warehouseController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new warehouse',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Warehouse created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `A new warehouse starts as \`${WarehouseStatusEnum.ACTIVE}\`. The code is unique among warehouses that are not deleted - a taken one answers 409. An \`address_id\` that resolves to nothing answers 404. ${defaultNote}`,
			body: {
				address_id: {
					type: 'number',
					required: true,
					condition: 'must resolve to an address that is not deleted',
				},
				code: {
					type: 'string',
					required: true,
					condition: 'up to 16 characters, unique, e.g. `BUC-01`',
				},
				name: { type: 'string', required: true },
				is_default: {
					type: 'boolean',
					required: false,
					default: false,
				},
				notes: { type: 'string', required: false },
			},
			sample: {
				address_id: 4,
				code: 'BUC-01',
				name: 'Bucharest Central',
				is_default: true,
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get warehouse details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Warehouse details, with its address',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'A deleted warehouse is only visible to a caller holding warehouse delete. The address is joined LEFT, so a warehouse whose address was removed still reads, with `address` null',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update warehouse',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Warehouse updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `Provide at least one of address_id, code, name, is_default or notes. A \`status\` in the body is ignored - it has its own route. ${defaultNote}`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				address_id: { type: 'number', required: false },
				code: {
					type: 'string',
					required: false,
					condition: 'up to 16 characters, unique',
				},
				name: { type: 'string', required: false },
				is_default: { type: 'boolean', required: false },
				notes: { type: 'string', required: false },
			},
			sample: {
				name: 'Bucharest Central Depot',
				is_default: true,
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete warehouse',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Warehouse deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Soft delete, whatever the status. A deleted warehouse releases both its code and the default flag, so either can be claimed by another row',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore warehouse',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Warehouse restored with success',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: 'Answers 409 when the code, or the default flag, was claimed by another warehouse while this one was deleted',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get warehouses',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Warehouse list',
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
						term: 'buc',
						status: WarehouseStatusEnum.ACTIVE,
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
					id: { type: 'number', required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the name and the code, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					address_id: { type: 'number', required: false },
					status: {
						type: 'enum',
						required: false,
						values: Object.values(WarehouseStatusEnum),
					},
					is_default: { type: 'boolean', required: false },
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only honored for a caller holding warehouse delete',
					},
				},
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Update warehouse status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Warehouse status updated successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: `Allowed moves: ${statusTransitionNote}. Anything else answers 422. Deactivating the default warehouse is allowed - it stays the default`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(WarehouseStatusEnum),
				},
			},
		},
	}),
};
