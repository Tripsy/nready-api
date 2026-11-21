import type VatRateEntity from '@/features/vat-rate/vat-rate.entity';
import { RatedVatCategoryEnum } from '@/features/vat-rate/vat-rate.entity';
import {
	OrderByEnum,
	VatRateValidator,
} from '@/features/vat-rate/vat-rate.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const vatRateValidator = new VatRateValidator('vat-rate');

const DAY_IN_SECONDS = 86400;

export function getVatRateEntityMock(): VatRateEntity {
	return {
		id: mockId(1),
		country_code: 'RO',
		category: RatedVatCategoryEnum.REDUCED,
		rate: 11,
		valid_from: '2025-08-01',
		notes: 'Law 141/2025',
		created_at: createPastDate(DAY_IN_SECONDS),
		updated_at: null,
	};
}

export const vatRateInputPayloads = {
	create: {
		country_code: 'RO',
		category: RatedVatCategoryEnum.REDUCED,
		rate: 11,
		valid_from: '2025-08-01',
		notes: 'Law 141/2025',
	},
	update: {
		id: mockId(1),
		rate: 11,
		notes: 'Food and non-alcoholic restaurant service',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.VALID_FROM,
		direction: OrderDirectionEnum.DESC,
		filter: {
			country_code: 'RO',
		},
	},
};

export const vatRateOutputPayloads = {
	create: vatRateValidator.create.parse(vatRateInputPayloads.create),
	update: vatRateValidator.update.parse(vatRateInputPayloads.update),
	find: vatRateValidator.find.parse(vatRateInputPayloads.find),
};
