import type { placePublicController } from '@/features/place/place-public.controller';
import { PLACE_PUBLIC_LIMIT } from '@/features/place/place-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/** The storefront half: the city search an address form types into. */
export const docs: Record<
	keyof typeof placePublicController,
	ApiInputDocumentation
> = {
	find: helperApiInputDocumentation({
		description: 'Search cities by name',
		success: {
			status: 200,
			description: `Up to ${PLACE_PUBLIC_LIMIT} cities, each with its parent region or country, named in the request language`,
			dataSample: {
				entries: [
					{
						id: 12,
						place_type: 'city',
						code: null,
						contents: [
							{
								language: 'en',
								name: 'Cluj-Napoca',
								type_label: 'city',
							},
						],
						parent: {
							id: 3,
							place_type: 'region',
							code: 'CJ',
							contents: [
								{
									language: 'en',
									name: 'Cluj',
									type_label: 'county',
								},
							],
						},
					},
				],
			},
		},
		withErrors: [422],
		request: {
			notes: 'No account required - place names are reference data. Cities only, matched by name prefix; the dashboard `GET /places` stays behind the `place` permission',
			query: {
				term: {
					type: 'string',
					required: true,
					condition:
						'the start of the city name, at least the configured minimum term length',
				},
			},
		},
	}),
};
