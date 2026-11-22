import { Configuration } from '@/config/settings.config';
import type { imageController } from '@/features/image/image.controller';
import {
	ImageMimeEnum,
	ImageSectionEnum,
	ImageStatusEnum,
	ImageStorageEnum,
	ImageTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/image/image.entity';
import {
	getImageEntityMock,
	imageInputPayloads,
} from '@/features/image/image.mock';
import { OrderByEnum } from '@/features/image/image.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getImageEntityMock() as unknown as Record<string, unknown>;

/** Rendered as `active -> inactive`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

/**
 * The row records where a file already is; it never carries the file. Whoever uploads writes it to
 * the storage backend first and registers the result here, which is why `storage` and `path` are
 * plain input rather than something this feature derives.
 */
const storageNote =
	'This endpoint registers a file that is already stored: storage and path describe where it landed, and nothing here reads, moves or verifies it';

const contentsFormat =
	'[{ language: string; title?: string; description?: string }]';

const propertiesFormat =
	'{ width?: number; height?: number; size: number; mime: string }';

const targetParams = {
	section: {
		type: 'enum' as const,
		required: true,
		values: Object.values(ImageSectionEnum),
	},
	entity_id: {
		type: 'string' as const,
		required: true,
		condition:
			'the row in that section; the pair carries no foreign key, so nothing here checks that it exists',
	},
};

const languageParam = {
	type: 'enum' as const,
	required: false,
	values: Configuration.get('language.supported'),
	condition: 'selects the translation the contents are returned in',
};

export const docs: Record<keyof typeof imageController, ApiInputDocumentation> =
	{
		create: helperApiInputDocumentation({
			description: 'Register an image against a target',
			withBearerAuth: true,
			success: {
				status: 201,
				description: 'Image created successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [400, 422],
			request: {
				notes: `${storageNote}. size and mime are required inside properties, while width and height are not. A target holds one ${ImageTypeEnum.LOGO} and as many ${ImageTypeEnum.GALLERY} images as it needs, and only the gallery is orderable`,
				params: targetParams,
				body: {
					image_type: {
						type: 'enum',
						required: true,
						values: Object.values(ImageTypeEnum),
					},
					storage: {
						type: 'enum',
						required: true,
						values: Object.values(ImageStorageEnum),
					},
					path: {
						type: 'string',
						required: true,
						condition:
							'where the file sits inside that storage backend',
					},
					properties: {
						type: 'object',
						required: true,
						format: propertiesFormat,
						condition: `mime is one of ${Object.values(ImageMimeEnum).join(', ')}`,
					},
					sort_order: { type: 'number', required: false },
					contents: {
						type: 'array',
						required: true,
						format: contentsFormat,
						condition:
							'at least one entry, and one per language - a repeated language is rejected; title and description are optional within an entry',
					},
				},
				sample: imageInputPayloads.create,
			},
		}),
		read: helperApiInputDocumentation({
			description: 'Get image details',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Image details',
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
			description: 'Update image content',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Image updated successfully',
				dataSample: entitySample,
			},
			withAuthErrors: true,
			withErrors: [400, 404, 422],
			request: {
				notes: 'Only contents can be changed. The file, its target, its type and its storage are what the row records - replacing an image means registering the new file and removing this row. Status and order have their own routes',
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
				body: {
					contents: {
						type: 'array',
						required: true,
						format: contentsFormat,
						condition:
							'at least one entry, one per language; an upsert, so a language left out keeps what it had',
					},
				},
				sample: imageInputPayloads.update,
			},
		}),
		delete: helperApiInputDocumentation({
			description: 'Delete image',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Image deleted with success',
			},
			withAuthErrors: true,
			withErrors: [404],
			request: {
				notes: 'Hard - the table has no deleted state and therefore no restore. The translations follow through the cascade, but the stored file does not: removing it belongs to whoever put it there. The same is true of the sweep that clears images when their target is removed',
				params: {
					id: {
						type: 'string',
						required: true,
					},
				},
			},
		}),
		find: helperApiInputDocumentation({
			description: 'Get images',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Image list',
				dataSample: {
					entries: [],
					pagination: {
						page: 1,
						limit: 5,
						total: 0,
					},
					query: {
						order_by: OrderByEnum.SORT_ORDER,
						direction: OrderDirectionEnum.ASC,
						limit: 5,
						page: 1,
						filter: {
							section: ImageSectionEnum.PRODUCT,
							entity_id: 1,
						},
					},
				},
			},
			withAuthErrors: true,
			request: {
				notes: 'Every row carries its contents in every language, unless the language filter narrows them. There is no search term here - an image is found through its target',
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
						section: {
							type: 'enum',
							required: false,
							values: Object.values(ImageSectionEnum),
						},
						entity_id: {
							type: 'array',
							required: false,
							format: 'string[]',
						},
						image_type: {
							type: 'enum',
							required: false,
							values: Object.values(ImageTypeEnum),
						},
						status: {
							type: 'enum',
							required: false,
							values: Object.values(ImageStatusEnum),
						},
						language: languageParam,
					},
				},
				sample: imageInputPayloads.find,
			},
		}),
		statusUpdate: helperApiInputDocumentation({
			description: 'Move an image to another status',
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Image status updated with success',
			},
			withAuthErrors: true,
			withErrors: [400, 404, 409, 422],
			request: {
				notes: `Only these transitions are allowed: ${statusTransitionNote}. An inactive image is skipped by the lookup that picks the one standing for a target, and the move resets sort_order - the image leaves its ordered group either way`,
				params: {
					id: {
						type: 'string',
						required: true,
					},
					status: {
						type: 'enum',
						required: true,
						values: Object.values(ImageStatusEnum),
					},
				},
			},
		}),
		orderUpdate: helperApiInputDocumentation({
			description: "Reorder one target's gallery",
			withBearerAuth: true,
			success: {
				status: 200,
				description: 'Image order updated with success',
			},
			withAuthErrors: true,
			withErrors: [400, 422],
			request: {
				notes: `Gallery images only, and only those belonging to the section and entity in the path - an id outside that set is refused by name rather than skipped. Unlike the category reorder, each entry carries its own sort_order rather than taking it from its position in the array`,
				params: targetParams,
				body: {
					positions: {
						type: 'array',
						required: true,
						format: '[{ id: EntityId; sort_order: number }]',
						condition: 'at least two entries, with distinct ids',
					},
				},
				sample: imageInputPayloads.orderUpdate,
			},
		}),
	};
