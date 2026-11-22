import { Configuration } from '@/config/settings.config';
import type { brandController } from '@/features/brand/brand.controller';
import {
	BrandStatusEnum,
	BrandTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/brand/brand.entity';
import {
	brandInputPayloads,
	getBrandEntityMock,
} from '@/features/brand/brand.mock';
import { OrderByEnum } from '@/features/brand/brand.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getBrandEntityMock() as unknown as Record<string, unknown>;

/** Rendered as `active -> inactive`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

const contentsFormat =
	'[{ language: string; description?: string; meta?: { title?: string; description?: string; keywords?: string } }]';

const slugNote =
	'slug is trimmed and lower-cased, and unique per brand_type among the rows that are not deleted - a soft-deleted brand releases its slug';

const languageParam = {
	type: 'enum' as const,
	required: false,
	values: Configuration.get('language.supported'),
	condition: 'selects the translation the contents are returned in',
};

export const docs: Record<keyof typeof brandController, ApiInputDocumentation> =
	{
		create: helperApiInputDocumentation({
			description: 'Create a new brand',
			withBearerAuth: true,
			success: {
				status: 201,
				description: 'Brand created successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [400, 409, 422],
			request: {
				notes: `${slugNote}. A collision answers 409 rather than a validation error`,
				body: {
					name: { type: 'string', required: true },
					slug: { type: 'string', required: true },
					brand_type: {
						type: 'enum',
						required: true,
						values: Object.values(BrandTypeEnum),
					},
					contents: {
						type: 'array',
						required: true,
						format: contentsFormat,
						condition:
							'at least one entry, and one per language - a repeated language is rejected',
					},
				},
				sample: brandInputPayloads.create,
			},
		}),
		read: helperApiInputDocumentation({
			description: 'Get brand details',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand details',
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
			description: 'Update brand',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand updated successfully',
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
				notes: `Provide at least one body parameter. ${slugNote}, so changing either half of the pair is re-checked`,
				body: {
					name: { type: 'string', required: false },
					slug: { type: 'string', required: false },
					brand_type: {
						type: 'enum',
						required: false,
						values: Object.values(BrandTypeEnum),
					},
					contents: {
						type: 'array',
						required: false,
						format: contentsFormat,
						condition:
							'replaces the stored entries for the languages it carries',
					},
				},
				sample: brandInputPayloads.update,
			},
		}),
		delete: helperApiInputDocumentation({
			description: 'Delete brand',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand deleted with success',
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
			description: 'Restore brand',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand restored with success',
			},
			withAuthErrors: true,
			withErrors: [404, 409],
			request: {
				notes: 'Answers 409 if the slug has been taken again in the meantime, since it is unique per brand_type only among the rows that are not deleted',
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
			},
		}),
		statusUpdate: helperApiInputDocumentation({
			description: 'Move a brand to another status',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand status updated with success',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [404, 422],
			request: {
				notes: `Only these transitions are allowed: ${statusTransitionNote}`,
				params: {
					id: {
						type: 'string',
						required: true,
					},
					status: {
						type: 'enum',
						required: true,
						values: Object.values(BrandStatusEnum),
					},
				},
			},
		}),
		orderUpdate: helperApiInputDocumentation({
			description: 'Reorder the brands of one type',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand order updated with success',
			},
			withAuthErrors: true,
			withErrors: [400, 422],
			request: {
				notes: '`positions` is the whole group in the order wanted, at least two ids - it sets `sort_order`, which `order_by=sort_order` then reads',
				params: {
					brand_type: {
						type: 'enum',
						required: true,
						values: Object.values(BrandTypeEnum),
					},
				},
				body: {
					positions: {
						type: 'array',
						required: true,
						format: 'number[]',
						condition: 'at least two ids',
					},
				},
				sample: brandInputPayloads.orderUpdate,
			},
		}),
		find: helperApiInputDocumentation({
			description: 'Get brands',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Brand list',
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
							term: 'pepsi',
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
						id: {
							type: 'array',
							required: false,
							format: 'number[]',
							condition:
								'one id or several; a single value may be sent unwrapped',
						},
						term: {
							type: 'string',
							required: false,
							condition: `at least ${Configuration.get('filter.termMinLength')} characters`,
						},
						brand_type: {
							type: 'enum',
							required: false,
							values: Object.values(BrandTypeEnum),
						},
						status: {
							type: 'enum',
							required: false,
							values: Object.values(BrandStatusEnum),
						},
						language: languageParam,
						is_deleted: {
							type: 'boolean',
							required: false,
							default: false,
						},
					},
				},
				sample: brandInputPayloads.find,
			},
		}),
	};
