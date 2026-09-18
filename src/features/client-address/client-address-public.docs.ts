import { ClientAddressTypeEnum } from '@/features/client-address/client-address.entity';
import { getClientAddressEntityMock } from '@/features/client-address/client-address.mock';
import type { clientAddressPublicController } from '@/features/client-address/client-address-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

const entitySample = {
	...(getClientAddressEntityMock() as unknown as Record<string, unknown>),
	address: {
		id: 1,
		city_id: 12,
		details: 'Str. Memorandumului 28',
		postal_code: '400114',
	},
	place: { city: 'Cluj-Napoca', region: 'Cluj', country: 'Romania' },
};

const typeValues = Object.values(ClientAddressTypeEnum);

/**
 * The storefront half: billing and delivery addresses under the caller's own clients. Every row is
 * reached through a client the account holds; anything else answers 404.
 */
export const docs: Record<
	keyof typeof clientAddressPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: "One of your clients' addresses",
		withBearerAuth: true,
		success: {
			status: 200,
			description:
				'Every address filed under the client, newest first, with place names resolved',
			dataSample: { entries: [entitySample] },
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: 'Requires an account holding the client. Unpaginated - a client holds a handful of addresses. `place` carries the city, region and country names in the request language',
			query: {
				client_id: {
					type: 'number',
					required: true,
					condition: "one of the caller's own clients",
				},
				type: { type: 'enum', required: false, values: typeValues },
			},
		},
	}),

	create: helperApiInputDocumentation({
		description: 'Add a billing or delivery address to one of your clients',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'The address, as the list returns it',
			dataSample: entitySample,
			withMessage: true,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: 'Requires an account holding the client. Send either `address_id` - an address picked from `GET /public/addresses`, linked the way the dashboard links one - or `city_id` + `street` (+ `postal_code`) to write a new address row; both at once is refused. There is no update: an address is added or removed, since the linked row may be filed against other clients too',
			body: {
				client_id: {
					type: 'number',
					required: true,
					condition: "one of the caller's own clients",
				},
				type: { type: 'enum', required: true, values: typeValues },
				address_id: {
					type: 'number',
					required: false,
					condition:
						'an existing address from `GET /public/addresses`; required unless city_id and street are sent',
				},
				city_id: {
					type: 'number',
					required: false,
					condition:
						'a city from `GET /public/places`; required with street when address_id is absent',
				},
				street: {
					type: 'string',
					required: false,
					condition:
						'street and number; required with city_id when address_id is absent',
				},
				postal_code: {
					type: 'string',
					required: false,
					condition: 'only with city_id and street',
				},
				details: {
					type: 'string',
					required: false,
					condition: 'flat, floor or apartment number',
				},
				notes: {
					type: 'string',
					required: false,
					condition: 'instructions about reaching the address',
				},
			},
		},
	}),

	delete: helperApiInputDocumentation({
		description: 'Remove one of your addresses',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Address removed',
			withMessage: true,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Deleted outright; the address row it pointed at stays. Orders keep their own copy of the address they were placed with, so nothing already placed changes',
			params: {
				id: {
					type: 'number',
					required: true,
					condition:
						"an address under one of the caller's own clients",
				},
			},
		},
	}),
};
