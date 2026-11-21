import { Configuration } from '@/config/settings.config';
import type { carrierController } from '@/features/carrier/carrier.controller';
import {
	carrierInputPayloads,
	getCarrierEntityMock,
} from '@/features/carrier/carrier.mock';
import { OrderByEnum } from '@/features/carrier/carrier.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getCarrierEntityMock() as unknown as Record<
	string,
	unknown
>;

const nameNote =
	'name is unique among the rows that are not deleted - a soft-deleted carrier releases its name, and restoring it fails while another carrier holds it';

const websiteParam = {
	type: 'string' as const,
	required: false,
	condition: 'free text, not validated as a URL',
};

const phoneParam = {
	type: 'string' as const,
	required: false,
	condition:
		'7 to 15 digits with an optional leading +; spaces, dots, dashes and parentheses are ignored',
};

const emailParam = {
	type: 'string' as const,
	required: false,
};

const notesParam = {
	type: 'string' as const,
	required: false,
};

export const docs: Record<
	keyof typeof carrierController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new carrier',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Carrier created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `${nameNote}. A collision answers 409 rather than a validation error`,
			body: {
				name: { type: 'string', required: true },
				website: websiteParam,
				phone: phoneParam,
				email: emailParam,
				notes: notesParam,
			},
			sample: carrierInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get carrier details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Carrier details',
			dataSample: entitySample,
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
		description: 'Update carrier',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Carrier updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			notes: `Provide at least one body parameter. ${nameNote}, so a new name is re-checked against the other carriers`,
			body: {
				name: { type: 'string', required: false },
				website: websiteParam,
				phone: phoneParam,
				email: emailParam,
				notes: notesParam,
			},
			sample: carrierInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete carrier',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Carrier deleted with success',
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
		description: 'Restore carrier',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Carrier restored with success',
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
		description: 'Get carriers',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Carrier list',
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
						term: 'Fun Drive',
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
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
						condition: `an all-digit term matches the id exactly; otherwise name and website, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: carrierInputPayloads.find,
		},
	}),
};
