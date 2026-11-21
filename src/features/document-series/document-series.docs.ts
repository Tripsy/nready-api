import { Configuration } from '@/config/settings.config';
import type { documentSeriesController } from '@/features/document-series/document-series.controller';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import {
	documentSeriesInputPayloads,
	getDocumentSeriesEntityMock,
} from '@/features/document-series/document-series.mock';
import { OrderByEnum } from '@/features/document-series/document-series.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getDocumentSeriesEntityMock() as unknown as Record<
	string,
	unknown
>;

const counterNote =
	"next_number is not writable through this API: it only ever moves when a document allocates from the series, inside that document's own transaction, which is what keeps the numbering gapless";

const codeParam = {
	type: 'string' as const,
	condition: 'at most 10 characters; the prefix a reference is rendered with',
};

const notesParam = {
	type: 'string' as const,
	required: false,
};

export const docs: Record<
	keyof typeof documentSeriesController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new numbering series',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Document series created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `One series per document type - a second one for the same type answers 409. The counter starts at start_number, so a series taking over from a legacy numbering is created with that set. ${counterNote}`,
			body: {
				document_type: {
					type: 'enum',
					required: true,
					values: Object.values(DocumentTypeEnum),
				},
				code: { ...codeParam, required: true },
				start_number: {
					type: 'number',
					required: false,
					default: 1,
					condition: 'must be positive',
				},
				notes: notesParam,
			},
			sample: documentSeriesInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get numbering series details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Document series details',
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
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update numbering series',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Document series updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: `Provide at least one body parameter. document_type is not updatable - it is the key an allocation resolves on, and moving it would hand already-issued numbers to another series. ${counterNote}, so raising start_number on a series that has issued anything documents an intent without changing what comes next`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				code: { ...codeParam, required: false },
				start_number: {
					type: 'number',
					required: false,
					condition: 'must be positive',
				},
				notes: notesParam,
			},
			sample: documentSeriesInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete numbering series',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Document series deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Hard - the table has no deleted state and therefore no restore. Nothing stops the removal of a series that has already issued numbers, and recreating it starts the counter again from start_number, which then collides with the references already carrying that code',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get numbering series',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Document series list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						document_type: DocumentTypeEnum.INVOICE,
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
					id: { type: 'string', required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the code, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					document_type: {
						type: 'enum',
						required: false,
						values: Object.values(DocumentTypeEnum),
					},
				},
			},
			sample: documentSeriesInputPayloads.find,
		},
	}),
};
