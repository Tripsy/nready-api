import { Configuration } from '@/config/settings.config';
import type { clientAddressController } from '@/features/client-address/client-address.controller';
import { ClientAddressTypeEnum } from '@/features/client-address/client-address.entity';
import {
	clientAddressInputPayloads,
	getClientAddressEntityMock,
} from '@/features/client-address/client-address.mock';
import { OrderByEnum } from '@/features/client-address/client-address.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getClientAddressEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * The street data lives on the joined `address`, whose city name is translated - which is why the
 * reads take a `language` the writes have no use for.
 */
const languageParam = {
	type: 'enum' as const,
	required: false,
	values: Configuration.get('language.supported'),
	condition: 'selects the translation the joined city is returned in',
};

const typeValues = Object.values(ClientAddressTypeEnum);

const detailsParam = {
	type: 'string' as const,
	required: false,
	condition: 'flat, floor or apartment number within the address',
};

const notesParam = {
	type: 'string' as const,
	required: false,
	condition: 'instructions about reaching the address',
};

export const docs: Record<
	keyof typeof clientAddressController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description:
			'File an existing address against a client as billing or delivery',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Client address created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: 'The address must already exist - create it through `POST /address` first. Answers 404 for a client or an address that does not exist or was deleted',
			body: {
				client_id: { type: 'number', required: true },
				address_id: {
					type: 'number',
					required: true,
					condition: 'may already be filed against other clients',
				},
				type: { type: 'enum', required: true, values: typeValues },
				details: detailsParam,
				notes: notesParam,
			},
			sample: clientAddressInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get client address details, with its address and client',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client address details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: { type: 'number', required: true },
			},
			query: {
				language: languageParam,
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update client address',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client address updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			params: {
				id: { type: 'number', required: true },
			},
			notes: 'Provide at least one body parameter. The client cannot be changed, and the address itself is never edited here - sending another address_id points the row at that address instead. A field left unset keeps its stored value',
			body: {
				type: { type: 'enum', required: false, values: typeValues },
				address_id: { type: 'number', required: false },
				details: detailsParam,
				notes: notesParam,
			},
			sample: clientAddressInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description:
			'Delete client address permanently - there is no restore, and the address itself is kept',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client address deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: { type: 'number', required: true },
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get client addresses',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client address list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 10,
					total: 0,
				},
				query: {
					order_by: 'id',
					direction: 'DESC',
					limit: 10,
					page: 1,
					filter: {
						client_id: 1,
						type: ClientAddressTypeEnum.BILLING,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			query: {
				page: { type: 'number', required: false, default: 1 },
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
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: { type: 'number', required: false },
					client_id: { type: 'number', required: false },
					address_id: { type: 'number', required: false },
					type: { type: 'enum', required: false, values: typeValues },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the details, the street line and the postal code, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					language: languageParam,
				},
			},
			sample: clientAddressInputPayloads.find,
		},
	}),
};
