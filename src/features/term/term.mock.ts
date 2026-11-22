import type TermEntity from '@/features/term/term.entity';
import { TermTypeEnum } from '@/features/term/term.entity';
import { OrderByEnum, TermValidator } from '@/features/term/term.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const termValidator = new TermValidator('term');

export function getTermEntityMock(): TermEntity {
	return {
		id: mockId(1),
		type: TermTypeEnum.TAG,
		created_at: createPastDate(28800),
		updated_at: null,
		deleted_at: null,
		contents: [],
	};
}

export const termInputPayloads = {
	create: {
		type: TermTypeEnum.TAG,
		contents: [
			{
				language: 'en',
				value: 'Summer',
			},
			{
				language: 'ro',
				value: 'Vara',
			},
		],
	},
	update: {
		id: mockId(1),
		type: TermTypeEnum.TAG,
		contents: [
			{
				language: 'en',
				value: 'Summer Update',
			},
		],
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			type: TermTypeEnum.TAG,
			language: 'en',
			term: 'test',
			is_deleted: true,
		},
	},
};

export const termOutputPayloads = {
	create: termValidator.create.parse(termInputPayloads.create),
	update: termValidator.update.parse(termInputPayloads.update),
	find: termValidator.find.parse(termInputPayloads.find),
};
