import type { addressPublicController } from '@/features/address/address-public.controller';
import { ADDRESS_PUBLIC_LIMIT } from '@/features/address/address-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/** The storefront half: the address search a checkout address form types into. */
export const docs: Record<
	keyof typeof addressPublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: 'Search addresses by street or postal code',
		withBearerAuth: true,
		success: {
			status: 200,
			description: `Up to ${ADDRESS_PUBLIC_LIMIT} addresses, newest first, each with its city and the city's parent named in the request language`,
			dataSample: {
				entries: [
					{
						id: 105,
						city_id: 22,
						details: 'Str. Memorandumului 28',
						postal_code: '400114',
						city: {
							id: 22,
							place_type: 'city',
							contents: [{ language: 'en', name: 'Cluj-Napoca' }],
							parent: {
								id: 8,
								place_type: 'region',
								contents: [{ language: 'en', name: 'Cluj' }],
							},
						},
					},
				],
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'Requires an account. Searches the whole address table, the same set the dashboard picker searches - so it returns addresses filed by other clients too. A pick is linked with `POST /public/client-addresses` `address_id`; when nothing matches, that endpoint takes `city_id` + `street` instead',
			query: {
				term: {
					type: 'string',
					required: true,
					condition:
						'part of the street or the postal code, at least the configured minimum term length',
				},
			},
		},
	}),
};
