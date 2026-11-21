import type DocumentSeriesEntity from '@/features/document-series/document-series.entity';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import {
	DocumentSeriesValidator,
	OrderByEnum,
} from '@/features/document-series/document-series.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const documentSeriesValidator = new DocumentSeriesValidator('document-series');

export function getDocumentSeriesEntityMock(): DocumentSeriesEntity {
	return {
		id: mockId(1),
		document_type: DocumentTypeEnum.INVOICE,
		code: 'INV',
		start_number: 1,
		next_number: 42,
		notes: null,
		created_at: createPastDate(86400),
		updated_at: createPastDate(43200),
	};
}

export const documentSeriesInputPayloads = {
	create: {
		document_type: DocumentTypeEnum.INVOICE,
		code: 'INV',
		start_number: 1,
		notes: 'Fiscal invoice series',
	},
	update: {
		id: mockId(1),
		code: 'INV',
		notes: 'Fiscal invoice series',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'INV',
			document_type: DocumentTypeEnum.INVOICE,
		},
	},
};

export const documentSeriesOutputPayloads = {
	create: documentSeriesValidator.create.parse(
		documentSeriesInputPayloads.create,
	),
	update: documentSeriesValidator.update.parse(
		documentSeriesInputPayloads.update,
	),
	find: documentSeriesValidator.find.parse(documentSeriesInputPayloads.find),
};
