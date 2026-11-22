import { Configuration } from '@/config/settings.config';
import type { vendorController } from '@/features/vendor/vendor.controller';
import {
	STATUS_TRANSITIONS,
	VendorStatusEnum,
	VendorTypeEnum,
} from '@/features/vendor/vendor.entity';
import { OrderByEnum } from '@/features/vendor/vendor.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Written out rather than taken from a `vendor.mock.ts`, which this feature does not have. The
 * row is the whole entity - a vendor carries no relations and no content of its own.
 */
const entitySample: Record<string, unknown> = {
	id: 1,
	name: 'Acme Services',
	type: VendorTypeEnum.PROVIDER,
	status: VendorStatusEnum.PENDING,
	created_at: '2026-08-20T09:14:00.000Z',
	updated_at: null,
	deleted_at: null,
};

/** Rendered as `pending -> active | inactive`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

const typeParam = {
	type: 'enum' as const,
	required: true,
	values: Object.values(VendorTypeEnum),
	condition:
		'what the vendor supplies: `supplier` for goods, `provider` for services',
};

/**
 * A vendor is a name, what it supplies, and where it stands. Nothing here is language-specific and
 * nothing hangs off it, so the row is the whole entity.
 *
 * `status` is never part of a create or an update body - it moves only through its own route, and
 * only along the transitions the entity declares.
 */
export const docs: Record<
	keyof typeof vendorController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new vendor',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Vendor created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'A new vendor starts as `pending` and is moved from there through the status route. The name is not unique - two vendors may share one',
			body: {
				name: { type: 'string', required: true },
				type: typeParam,
			},
			sample: {
				name: 'Acme Services',
				type: VendorTypeEnum.PROVIDER,
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get vendor details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Vendor details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'A deleted vendor is only visible to a caller holding vendor delete',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update vendor',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Vendor updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: 'Provide at least one of name or type. A `status` in the body is ignored - it has its own route',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				name: { type: 'string', required: false },
				type: { ...typeParam, required: false },
			},
			sample: {
				name: 'Acme Services SRL',
				type: VendorTypeEnum.PROVIDER,
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete vendor',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Vendor deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Soft delete, whatever the status - a deleted vendor keeps the status it had, and anything already pointing at it keeps resolving',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore vendor',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Vendor restored with success',
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
		description: 'Get vendors',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Vendor list',
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
						term: 'acme',
						type: VendorTypeEnum.PROVIDER,
						status: VendorStatusEnum.ACTIVE,
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
						condition: `an all-digit term matches the id exactly; otherwise the name alone, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					type: {
						type: 'enum',
						required: false,
						values: Object.values(VendorTypeEnum),
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(VendorStatusEnum),
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only takes effect for a caller holding vendor delete',
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: OrderByEnum.NAME,
				direction: OrderDirectionEnum.ASC,
				filter: {
					term: 'acme',
					type: VendorTypeEnum.PROVIDER,
					status: VendorStatusEnum.ACTIVE,
				},
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Move a vendor to another status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Vendor status updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote} - nothing returns a vendor to \`pending\`. Asking for the status it already holds answers 400, and a transition that is not allowed answers 409. A deleted vendor cannot be moved at all`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(VendorStatusEnum),
				},
			},
		},
	}),
};
