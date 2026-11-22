import { Configuration } from '@/config/settings.config';
import type { categoryController } from '@/features/category/category.controller';
import {
	CATEGORY_MAX_DEPTH,
	CategoryStatusEnum,
	CategoryTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/category/category.entity';
import {
	categoryInputPayloads,
	getCategoryEntityMock,
} from '@/features/category/category.mock';
import { OrderByEnum } from '@/features/category/category.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getCategoryEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Rendered as `active -> inactive`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

/** Rendered as `product: 3, article: 2` - counting a root as 1. */
const maxDepthNote = Object.entries(CATEGORY_MAX_DEPTH)
	.map(([type, maxDepth]) => `${type}: ${maxDepth}`)
	.join(', ');

const contentsFormat =
	'[{ language: string; label: string; slug: string; description: string; meta?: { title?: string; description?: string; keywords?: string } }]';

const parentNote = `A parent must share the category's type, and the placement must fit the type's depth ceiling (${maxDepthNote}, a root counting as 1)`;

const languageParam = {
	type: 'enum' as const,
	required: false,
	values: Configuration.get('language.supported'),
	condition:
		'selects the translation returned; falls back to the request language',
};

const typeParam = {
	type: 'enum' as const,
	values: Object.values(CategoryTypeEnum),
};

export const docs: Record<
	keyof typeof categoryController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new category',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Category created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `${parentNote}; omitting parent_id creates a root. The category starts as ${CategoryStatusEnum.PENDING}. Each content slug is trimmed and lower-cased, and is unique per type and language across every category`,
			body: {
				type: { ...typeParam, required: true },
				parent_id: {
					type: 'string',
					required: false,
					condition: 'an unknown parent answers 409',
				},
				contents: {
					type: 'array',
					required: true,
					format: contentsFormat,
					condition:
						'one entry per language; label, slug and description are required within an entry',
				},
			},
			sample: categoryInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get category details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'The immediate parent always rides along. ancestors lists the chain above, nearest last and excluding the category itself; children lists only the direct ones',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			query: {
				with_ancestors: {
					type: 'boolean',
					required: false,
					default: false,
				},
				with_children: {
					type: 'boolean',
					required: false,
					default: false,
				},
				language: languageParam,
			},
			sample: categoryInputPayloads.read,
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update category',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only parent_id and contents can be changed - type is fixed at creation, and status has its own route. Sending parent_id empty detaches the category to a root; sending an id moves it, with the whole subtree, which is what has to fit. ${parentNote}. A move under a descendant of itself, under a deleted parent, or under an inactive one while the category is active, is refused. Moving resets the sort order`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				parent_id: { type: 'string', required: false },
				contents: {
					type: 'array',
					required: false,
					format: contentsFormat,
					condition:
						'an upsert per language - a language left out keeps the content it had',
				},
			},
			sample: categoryInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete category',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: 'A category with a descendant that is not already deleted answers 409 - delete the tree from the leaves up',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore category',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category restored with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404],
		request: {
			notes: 'Refused while the parent is itself deleted or not active - restore the chain from the root down',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get categories',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category list',
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
						type: CategoryTypeEnum.ARTICLE,
						term: 'tech',
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'The listing is language-narrowed: a category with no content in the requested language is absent. Ordering by label reads the joined content row',
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
					language: languageParam,
					type: {
						...typeParam,
						required: false,
						default: CategoryTypeEnum.ARTICLE,
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(CategoryStatusEnum),
					},
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the label of the category and of its parent, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					parent_id: {
						type: 'string',
						required: false,
						condition:
							'addresses one sibling group; is_root wins when both are sent',
					},
					is_root: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'the categories with no parent - a null parent cannot be expressed through parent_id',
					},
					can_parent: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only categories with room left under their depth ceiling - what a parent picker should offer',
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: categoryInputPayloads.find,
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Move a category to another status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category status updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote}. Going ${CategoryStatusEnum.INACTIVE} with active descendants is refused unless force is set, which deactivates them too. Either way the sort order is reset`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: [
						CategoryStatusEnum.ACTIVE,
						CategoryStatusEnum.INACTIVE,
					],
					condition: `${CategoryStatusEnum.PENDING} is the starting status and cannot be returned to`,
				},
			},
			query: {
				force: {
					type: 'boolean',
					required: false,
					default: false,
				},
			},
			sample: categoryInputPayloads.statusUpdate,
		},
	}),
	orderUpdate: helperApiInputDocumentation({
		description: 'Reorder one sibling group',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Category order updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: 'The group is the active categories of one type under one parent - or the roots of that type when parent_id is omitted. positions must list that whole group, in the order wanted; a subset or a stray id is refused',
			params: {
				type: { ...typeParam, required: true },
			},
			body: {
				parent_id: { type: 'string', required: false },
				positions: {
					type: 'array',
					required: true,
					format: '[number]',
					condition: 'at least two ids',
				},
			},
			sample: categoryInputPayloads.orderUpdate,
		},
	}),
};
