import { Configuration } from '@/config/settings.config';
import type { termController } from '@/features/term/term.controller';
import { TermTypeEnum } from '@/features/term/term.entity';
import {
	getTermEntityMock,
	termInputPayloads,
} from '@/features/term/term.mock';
import { OrderByEnum } from '@/features/term/term.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * The mock's `contents` is empty - it stands in for the term row, which carries no wording of its
 * own - so the sample below fills it in, since a term without its translations names nothing.
 */
const entitySample: Record<string, unknown> = {
	...(getTermEntityMock() as unknown as Record<string, unknown>),
	contents: [
		{ language: 'en', value: 'summer' },
		{ language: 'ro', value: 'vara' },
	],
};

const duplicateNote =
	'two terms of the same type may not carry the same wording in the same language - the check is case-insensitive and answers 409';

const typeParam = {
	type: 'enum' as const,
	required: true,
	values: Object.values(TermTypeEnum),
	condition: 'decides what the term is used for, not what it says',
};

const contentsParam = {
	type: 'array' as const,
	required: true,
	condition:
		'one entry per language, each carrying language and value; at least one entry, a language may not repeat, and each value is at most 255 characters',
};

/**
 * A term is a language-neutral id with its wording held once per language in `term_content`.
 * Consumers point at the id and resolve the words at read time, so renaming a term changes it
 * everywhere at once.
 *
 * Every value is trimmed and lower-cased on the way in: a term is a label reused across many
 * rows, and "Summer" and "summer" rendering as two different tags is the failure that
 * normalizing at the column avoids.
 */
export const docs: Record<keyof typeof termController, ApiInputDocumentation> =
	{
		create: helperApiInputDocumentation({
			description: 'Create a new term',
			withBearerAuth: true,
			success: {
				status: 201,
				description: 'Term created successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [409, 422],
			request: {
				notes: `${duplicateNote}. The response carries the translations back even though they are written separately, so a caller linking the new term straight away has something to label it with`,
				body: {
					type: typeParam,
					contents: contentsParam,
				},
				sample: termInputPayloads.create,
			},
		}),
		read: helperApiInputDocumentation({
			description: 'Get term details',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Term details, with every translation',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [404, 422],
			request: {
				notes: 'Omitting `language` returns every translation, which is what an editor needs; naming one returns that translation alone and answers 404 when the term has none in it',
				params: {
					id: {
						type: 'string',
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
			description: 'Update term',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Term updated successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [404, 409, 422],
			request: {
				notes: `Provide at least one of type or contents. ${duplicateNote}, so new wording is re-checked against the other terms of the same type. Translations are upserted by language - a language left out of \`contents\` keeps what it already had, and none is ever removed by an update`,
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
				body: {
					type: { ...typeParam, required: false },
					contents: { ...contentsParam, required: false },
				},
				sample: termInputPayloads.update,
			},
		}),
		delete: helperApiInputDocumentation({
			description: 'Delete term',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Term deleted with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				notes: 'Soft delete, and nothing checks what points at the term - anything already referencing it keeps resolving. The duplicate rule ignores deleted rows, so the wording is free for reuse immediately',
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
			},
		}),
		restore: helperApiInputDocumentation({
			description: 'Restore term',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Term restored with success',
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
			description: 'Get terms',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Term list, one wording per row',
				dataSample: {
					entries: [
						{
							...entitySample,
							contents: [{ language: 'en', value: 'summer' }],
						},
					],
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
							type: TermTypeEnum.TAG,
							language: 'en',
							term: 'summ',
							is_deleted: false,
						},
					},
				},
			},
			withAuthErrors: true,
			withErrors: [422],
			request: {
				notes: 'The listing joins the translation for `language` but keeps a term that has none, returning it with an empty wording - this list is where those gaps are found and filled, and dropping the rows would hide exactly the ones needing attention',
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
							condition: `an all-digit term matches the id exactly; otherwise the wording in any language, from ${Configuration.get('filter.termMinLength')} characters - unlike the listing itself, the search is not limited to the filtered language`,
						},
						type: {
							type: 'enum',
							required: false,
							values: Object.values(TermTypeEnum),
						},
						language: {
							type: 'string',
							required: false,
							condition:
								"decides which wording each row carries; defaults to the request's own language",
						},
						is_deleted: {
							type: 'boolean',
							required: false,
							default: false,
							condition:
								'only takes effect for a caller holding term delete',
						},
					},
				},
				sample: termInputPayloads.find,
			},
		}),
	};
