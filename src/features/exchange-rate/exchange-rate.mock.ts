import type ExchangeRateEntity from '@/features/exchange-rate/exchange-rate.entity';
import { ExchangeRateSourceEnum } from '@/features/exchange-rate/exchange-rate.entity';
import {
	ExchangeRateValidator,
	OrderByEnum,
} from '@/features/exchange-rate/exchange-rate.validator';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const exchangeRateValidator = new ExchangeRateValidator('exchange-rate');

const DAY_IN_SECONDS = 86400;

/**
 * Yesterday rather than a literal: `create` refuses a future day, so a date fixed in the file
 * would start failing the payload parse below the moment the clock passed it.
 */
const rateDate = formatDate(createPastDate(DAY_IN_SECONDS), 'default', {
	strict: true,
}) as string;

export function getExchangeRateEntityMock(): ExchangeRateEntity {
	return {
		id: mockId(1),
		currency: 'EUR',
		base_currency: 'RON',
		rate: 5.2575,
		rate_date: rateDate,
		source: ExchangeRateSourceEnum.IMPORT,
		provider: 'bnr.ro',
		notes: null,
		created_at: createPastDate(DAY_IN_SECONDS),
		updated_at: null,
	};
}

export const exchangeRateInputPayloads = {
	create: {
		currency: 'EUR',
		rate: 5.2575,
		rate_date: rateDate,
		notes: 'Closing rate',
	},
	update: {
		id: mockId(1),
		rate: 5.2601,
		notes: 'Corrected after the published bulletin',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.RATE_DATE,
		direction: OrderDirectionEnum.DESC,
		filter: {
			currency: 'EUR',
			base_currency: 'RON',
		},
	},
};

export const exchangeRateOutputPayloads = {
	create: exchangeRateValidator.create.parse(
		exchangeRateInputPayloads.create,
	),
	update: exchangeRateValidator.update.parse(
		exchangeRateInputPayloads.update,
	),
	find: exchangeRateValidator.find.parse(exchangeRateInputPayloads.find),
};
