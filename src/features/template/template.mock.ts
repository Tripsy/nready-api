import type TemplateEntity from '@/features/template/template.entity';
import { TemplateTypeEnum } from '@/features/template/template.entity';
import {
	OrderByEnum,
	TemplateValidator,
} from '@/features/template/template.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const templateValidator = new TemplateValidator('template');

export function getTemplateEntityMock(): TemplateEntity {
	return {
		id: mockId(1),
		label: 'email-welcome',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Welcome',
			text: 'Hello',
			html: '<p>Hello</p>',
		},
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
	};
}

export const templateInputPayloads = {
	create: {
		label: 'email-welcome',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Welcome',
			text: 'Hello',
			html: '<p>Hello {{ name }}</p>',
		},
	},
	update: {
		id: mockId(1),
		label: 'email-welcome',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Welcome Updated',
			text: 'Hello',
			html: '<p>Hello {{ name }}</p>',
		},
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'welcome',
			language: 'en',
			type: TemplateTypeEnum.EMAIL,
			is_deleted: false,
		},
	},
};

export const templateOutputPayloads = {
	create: templateValidator.create.parse(templateInputPayloads.create),
	update: templateValidator.update.parse(templateInputPayloads.update),
	find: templateValidator.find.parse(templateInputPayloads.find),
};
