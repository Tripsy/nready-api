import { Configuration } from '@/config/settings.config';
import type { placeController } from '@/features/place/place.controller';
import { PlaceTypeEnum } from '@/features/place/place.entity';
import {
	getPlaceEntityMock,
	placeInputPayloads,
} from '@/features/place/place.mock';
import { OrderByEnum } from '@/features/place/place.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * The mock's `contents` is empty - it stands in for the row, and the translations live in their
 * own table - so the sample below carries one, which is what a caller actually reads back.
 */
const entitySample: Record<string, unknown> = {
	...(getPlaceEntityMock() as unknown as Record<string, unknown>),
	contents: [
		{
			language: 'en',
			name: 'Romania',
			type_label: 'Country',
		},
	],
};

const parentNote =
	'a country takes no parent, a region must sit under a country and a city under a region';

const placeTypeParam = {
	type: 'enum' as const,
	required: true,
	values: Object.values(PlaceTypeEnum),
};

const codeParam = {
	type: 'string' as const,
	required: false,
	condition:
		'an abbreviation, 3 characters at most; the natural key a seed links parents and children by - alpha-3 on a country',
};

const alpha2CodeParam = {
	type: 'string' as const,
	required: false,
	condition:
		'ISO 3166-1 alpha-2, on a country only - the vocabulary country rules are matched against (discount conditions, article visibility). Left empty on a region or a city',
};

const contentsParam = {
	type: 'array' as const,
	required: true,
	condition:
		'one entry per language, each carrying language, name and type_label; at least one entry, and a language may not repeat',
};

/**
 * Places form a country -> region -> city tree, with the name and the visitor-facing type label
 * held once per language in `place_content`. A translation is never written or deleted on its own:
 * it is upserted with its place and dies with it through the foreign key.
 */
export const docs: Record<keyof typeof placeController, ApiInputDocumentation> =
	{
		create: helperApiInputDocumentation({
			description: 'Create a new place',
			withBearerAuth: true,
			success: {
				status: 201,
				description: 'Place created successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [400, 409, 422],
			request: {
				notes: `${parentNote}. A parent of the wrong type, or one that does not exist, answers 409; a country given a parent answers 400`,
				body: {
					place_type: placeTypeParam,
					code: codeParam,
					alpha2_code: alpha2CodeParam,
					parent_id: {
						type: 'number',
						required: false,
						condition: 'required for a region or a city',
					},
					contents: contentsParam,
				},
				sample: placeInputPayloads.create,
			},
		}),
		read: helperApiInputDocumentation({
			description: 'Get place details',
			withBearerAuth: true,
			success: {
				status: 200,
				description:
					'Place details, with its parent and every translation',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [404, 422],
			request: {
				notes: 'Omitting `language` returns every translation, which is what an editor needs; naming one returns that translation alone and answers 404 when the place has none in it',
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
				query: {
					language: {
						type: 'string',
						required: false,
						condition: 'omit for every translation',
					},
				},
			},
		}),
		update: helperApiInputDocumentation({
			description: 'Update place',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Place updated successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [400, 404, 409, 422],
			request: {
				notes: `Provide at least one body parameter. ${parentNote}, and changing the type is refused with 400 while the place still has children. Translations are upserted by language - a language left out of \`contents\` keeps what it already had`,
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
				body: {
					place_type: { ...placeTypeParam, required: false },
					code: codeParam,
					alpha2_code: alpha2CodeParam,
					parent_id: {
						type: 'number',
						required: false,
						condition: 'required for a region or a city',
					},
					contents: { ...contentsParam, required: false },
				},
				sample: placeInputPayloads.update,
			},
		}),
		delete: helperApiInputDocumentation({
			description: 'Delete place',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Place deleted with success',
			},
			withAuthErrors: true,
			withErrors: [400, 404],
			request: {
				notes: 'Soft delete, and refused with 400 while the place still has a child that is not deleted - a branch comes down from the leaves up',
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
			},
		}),
		restore: helperApiInputDocumentation({
			description: 'Restore place',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Place restored with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				notes: 'Nothing checks the parent, so a place can come back under one that is still deleted',
				params: {
					id: {
						type: 'number',
						required: true,
					},
				},
			},
		}),
		find: helperApiInputDocumentation({
			description: 'Get places',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Place list, in one language',
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
							term: 'roma',
							place_type: PlaceTypeEnum.COUNTRY,
							language: 'en',
							is_deleted: false,
						},
					},
				},
			},
			withAuthErrors: true,
			withErrors: [422],
			request: {
				notes: 'The listing joins the translation for `language` and drops any place that has none, so a place entered in one language only is absent from the others',
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
							condition: `an all-digit term matches the id exactly; otherwise the name in the filtered language, as a prefix, from ${Configuration.get('filter.termMinLength')} characters`,
						},
						place_type: {
							type: 'enum',
							required: false,
							values: Object.values(PlaceTypeEnum),
						},
						language: {
							type: 'string',
							required: false,
							condition:
								"decides which translation the listing reads; defaults to the request's own language",
						},
						is_deleted: {
							type: 'boolean',
							required: false,
							default: false,
							condition:
								'only takes effect for a caller holding place delete',
						},
					},
				},
				sample: placeInputPayloads.find,
			},
		}),
	};
