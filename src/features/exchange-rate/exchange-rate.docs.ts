import { Configuration } from '@/config/settings.config';
import type { exchangeRateController } from '@/features/exchange-rate/exchange-rate.controller';
import { ExchangeRateSourceEnum } from '@/features/exchange-rate/exchange-rate.entity';
import {
	exchangeRateInputPayloads,
	getExchangeRateEntityMock,
} from '@/features/exchange-rate/exchange-rate.mock';
import { UPDATE_WINDOW_DAYS } from '@/features/exchange-rate/exchange-rate.service';
import { OrderByEnum } from '@/features/exchange-rate/exchange-rate.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getExchangeRateEntityMock() as unknown as Record<
	string,
	unknown
>;

const sourceNote = `source and provider are not writable: everything entered here is stored as ${ExchangeRateSourceEnum.MANUAL}, and ${ExchangeRateSourceEnum.IMPORT} is reserved for the feed that writes its own attribution`;

const currencyParam = {
	type: 'string' as const,
	condition: '3-letter ISO 4217 code, uppercased before it is stored',
};

const directionNote =
	"A row records what one unit of `currency` was worth in `base_currency` on `rate_date` - EUR, 5.2575, RON means 1 EUR = 5.2575 RON. `base_currency` is the deployment's own currency (`app.currency`), filled in by the server, so it is never sent: an amount in `currency` multiplied by `rate` reaches the books.";

const notesParam = {
	type: 'string' as const,
	required: false,
};

export const docs: Record<
	keyof typeof exchangeRateController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Add an exchange rate for a currency and day',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Exchange rate created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `${directionNote} One rate per currency per day: a second one for the same day answers 409. rate_date cannot be later than today, and the base currency itself is refused - it needs no rate. ${sourceNote}`,
			body: {
				currency: { ...currencyParam, required: true },
				rate: {
					type: 'number',
					required: true,
					condition:
						'positive, at most 8 decimals (the column is decimal(14, 8))',
				},
				rate_date: {
					type: 'string',
					required: true,
					condition: 'YYYY-MM-DD, today or earlier',
				},
				notes: notesParam,
			},
			sample: exchangeRateInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get exchange rate details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Exchange rate details',
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
		description: 'Update an exchange rate',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Exchange rate updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: `Provide at least one body parameter. Editable only while rate_date is within the last ${UPDATE_WINDOW_DAYS} days - an older rate answers 400, because documents have been priced against it. The currency and the day are not updatable: together they identify the row, so a wrong one is deleted and entered again. An edited row becomes ${ExchangeRateSourceEnum.MANUAL} whatever it was, which is what stops a later import from writing over a correction`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				rate: {
					type: 'number',
					required: false,
					condition: 'positive, at most 8 decimals',
				},
				notes: notesParam,
			},
			sample: exchangeRateInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete an exchange rate',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Exchange rate deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Hard - the table has no deleted state and therefore no restore. Documents already priced against the rate keep their own frozen copy of it, so removing the row does not move their figures; conversions asking for that day afterwards fall back to the last publication before it',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get exchange rates',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Exchange rate list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.RATE_DATE,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						currency: 'EUR',
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
					default: OrderByEnum.RATE_DATE,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: { type: 'string', required: false },
					currency: { ...currencyParam, required: false },
					base_currency: {
						...currencyParam,
						required: false,
						condition: `${currencyParam.condition}; only rows quoted into that currency, for a deployment whose base currency has changed`,
					},
					source: {
						type: 'enum',
						required: false,
						values: Object.values(ExchangeRateSourceEnum),
					},
					provider: { type: 'string', required: false },
					rate_date_start: {
						type: 'string',
						required: false,
						condition: 'YYYY-MM-DD, inclusive',
					},
					rate_date_end: {
						type: 'string',
						required: false,
						condition: 'YYYY-MM-DD, inclusive',
					},
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise either currency code or the provider, from ${Configuration.get('filter.termMinLength')} characters`,
					},
				},
			},
			sample: exchangeRateInputPayloads.find,
		},
	}),
};
