import { Configuration } from '@/config/settings.config';
import type { addressController } from '@/features/address/address.controller';
import {
	addressInputPayloads,
	getAddressEntityMock,
} from '@/features/address/address.mock';
import { OrderByEnum } from '@/features/address/address.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getAddressEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * `city_id` points at a `place`, whose name is translated - which is why the reads take a
 * `language` the writes have no use for.
 */
const languageParam = {
	type: 'enum' as const,
	required: false,
	values: Configuration.get('language.supported'),
	condition: 'selects the translation the joined city is returned in',
};

const cityIdParam = {
	type: 'number' as const,
	required: false,
	condition: 'a place id; the address keeps its own text when left unset',
};

const postalCodeParam = {
	type: 'string' as const,
	required: false,
};

export const docs: Record<
	keyof typeof addressController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new address',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Address created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			body: {
				city_id: cityIdParam,
				details: {
					type: 'string',
					required: true,
					condition: 'the street line; the only required field',
				},
				postal_code: postalCodeParam,
			},
			sample: addressInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get address details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Address details',
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
			query: {
				language: languageParam,
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update address',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Address updated successfully',
			dataSample: entitySample,
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
			notes: 'Provide at least one body parameter',
			body: {
				city_id: cityIdParam,
				details: { type: 'string', required: false },
				postal_code: postalCodeParam,
			},
			sample: addressInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete address',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Address deleted with success',
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
		description: 'Restore address',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Address restored with success',
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
		description: 'Get addresses',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Address list',
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
						term: 'Florio',
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'Ordering is by id only - the entity exposes no other sortable column',
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
						condition: `an all-digit term matches the id exactly; otherwise details and postal_code, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					language: languageParam,
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: addressInputPayloads.find,
		},
	}),
};
