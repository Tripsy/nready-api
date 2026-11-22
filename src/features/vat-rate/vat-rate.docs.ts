import { Configuration } from '@/config/settings.config';
import type { vatRateController } from '@/features/vat-rate/vat-rate.controller';
import { RatedVatCategoryEnum } from '@/features/vat-rate/vat-rate.entity';
import {
	getVatRateEntityMock,
	vatRateInputPayloads,
} from '@/features/vat-rate/vat-rate.mock';
import { OrderByEnum } from '@/features/vat-rate/vat-rate.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getVatRateEntityMock() as unknown as Record<
	string,
	unknown
>;

const modelNote =
	"A row says what percentage a VAT class carries in a country from `valid_from` on. The rate in force on a day is the row with the newest `valid_from` on or before it, so a rate change is one new row dated the day the law applies - there is no end date to maintain. `zero` and `exempt` are 0 everywhere and have no rows. The shop is priced at `company.addressCountry`; a rated class with no row falls back to that country's `standard` rate, and a country with no `standard` rate refuses pricing with 409. Orders and invoices freeze the rate onto their lines, so no change here moves a document already written";

const countryParam = {
	type: 'string' as const,
	condition: '2-letter ISO 3166-1 code, uppercased before it is stored',
};

const categoryParam = {
	type: 'enum' as const,
	values: Object.values(RatedVatCategoryEnum),
};

const notesParam = {
	type: 'string' as const,
	required: false,
};

const idParams = {
	id: {
		type: 'number' as const,
		required: true,
	},
};

export const docs: Record<
	keyof typeof vatRateController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Add a VAT rate for a country and class, from a day',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'VAT rate created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `${modelNote}. One row per country, class and day: a second one answers 409. valid_from may be in the future - the rate takes over on its own at midnight company time`,
			body: {
				country_code: { ...countryParam, required: true },
				category: { ...categoryParam, required: true },
				rate: {
					type: 'number',
					required: true,
					condition: 'percentage, 0 to below 100, at most 2 decimals',
				},
				valid_from: {
					type: 'string',
					required: true,
					condition: 'YYYY-MM-DD',
				},
				notes: notesParam,
			},
			sample: vatRateInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get VAT rate details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'VAT rate details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: idParams,
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update a VAT rate',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'VAT rate updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: 'Provide at least one body parameter. The country, class and day are not updatable: together they identify the row, so a wrong one is deleted and entered again. A correction reaches carts and catalog quotes at once; orders and invoices keep the rate they froze',
			params: idParams,
			body: {
				rate: {
					type: 'number',
					required: false,
					condition: 'percentage, 0 to below 100, at most 2 decimals',
				},
				notes: notesParam,
			},
			sample: vatRateInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete a VAT rate',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'VAT rate deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Hard - the table has no deleted state and therefore no restore. The row before it in the same country and class takes its period back',
			params: idParams,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get VAT rates',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'VAT rate list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.VALID_FROM,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						country_code: 'RO',
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
					default: OrderByEnum.VALID_FROM,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: { type: 'number', required: false },
					country_code: { ...countryParam, required: false },
					category: { ...categoryParam, required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the country code or the notes, from ${Configuration.get('filter.termMinLength')} characters`,
					},
				},
			},
			sample: vatRateInputPayloads.find,
		},
	}),
};
