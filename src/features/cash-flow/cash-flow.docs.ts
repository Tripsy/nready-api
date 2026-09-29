import { Configuration } from '@/config/settings.config';
import type { cashFlowController } from '@/features/cash-flow/cash-flow.controller';
import {
	AMOUNT_DECIMALS,
	CashFlowCategoryTypeEnum,
	CashFlowDirectionEnum,
	CashFlowMethodEnum,
	CashFlowStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/cash-flow/cash-flow.entity';
import {
	cashFlowInputPayloads,
	getCashFlowEntityMock,
} from '@/features/cash-flow/cash-flow.mock';
import { OrderByEnum } from '@/features/cash-flow/cash-flow.validator';
import { CashFlowCategoryEnum } from '@/features/cash-flow/cash-flow-category.enum';
import { OperationalRecordTypeEnum } from '@/features/cash-flow/operational-record.entity';
import { getClientEntityMock } from '@/features/client/client.mock';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getCashFlowEntityMock() as unknown as Record<
	string,
	unknown
>;

/** Rendered as `pending -> authorized | completed`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ') || 'none'}`)
	.join('; ');

/**
 * `direction` and `category_type` are not free: `category` decides both, and the entity carries
 * a CHECK constraint over the trio, so a caller sending a combination the service rejects would
 * otherwise reach the database and fail there.
 */
const consistencyNote =
	'category decides the pair: sale -> revenue/in; vendor, insurance and taxes -> expense/out; refund -> correction, either direction';

const amountNote = `amount is stored as a positive integer scaled by 10^${AMOUNT_DECIMALS}, so the sign is dropped and anything past the ${AMOUNT_DECIMALS}th decimal with it; gross and net are derived from it and vat_rate on read`;

const operationalRecordsFormat = `{ ${Object.values(OperationalRecordTypeEnum).join('?: number; ')}?: number }`;

const operationalRecordsCondition =
	'sale requires client and optionally takes order - the document the payment was raised for, which confirms itself once the movement is captured; vendor, insurance and taxes require vendor. A type the category does not allow is dropped silently rather than refused. Records may be rewritten in any status, so an operator can attach the order to a movement already captured; a required type may not be unlinked';

const amountParam = {
	type: 'number' as const,
	condition: amountNote,
};

const vatRateParam = {
	type: 'number' as const,
	condition: 'positive, max 2 decimals',
};

const currencyParam = {
	type: 'string' as const,
	required: false,
	condition: `3-letter ISO 4217 code; defaults to the deployment currency (${Configuration.currency()}); the exchange rate to it is captured on the row`,
};

export const docs: Record<
	keyof typeof cashFlowController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new cash flow entry',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Cash flow created successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 409, 422],
		request: {
			notes: `${consistencyNote}. ${amountNote}. A refund needs parent_id and the \`refund\` operation on top of \`create\``,
			body: {
				direction: {
					type: 'enum',
					required: true,
					values: Object.values(CashFlowDirectionEnum),
				},
				category_type: {
					type: 'enum',
					required: true,
					values: Object.values(CashFlowCategoryTypeEnum),
				},
				category: {
					type: 'enum',
					required: true,
					values: Object.values(CashFlowCategoryEnum),
				},
				method: {
					type: 'enum',
					required: true,
					values: Object.values(CashFlowMethodEnum),
				},
				amount: { ...amountParam, required: true },
				vat_rate: { ...vatRateParam, required: true },
				currency: currencyParam,
				external_reference: { type: 'string', required: false },
				parent_id: {
					type: 'number',
					required: false,
					condition:
						'the refunded entry; required when category is refund, and it must be completed, share the currency, and have enough left unrefunded',
				},
				notes: { type: 'string', required: false },
				operational_records: {
					type: 'object',
					required: false,
					format: operationalRecordsFormat,
					condition: operationalRecordsCondition,
				},
			},
			sample: cashFlowInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get cash flow details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cash flow details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update cash flow',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cash flow updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Provide at least one body parameter. Only an entry in ${CashFlowStatusEnum.PENDING}, ${CashFlowStatusEnum.AUTHORIZED} or ${CashFlowStatusEnum.REQUIRES_ACTION} can be updated - anything else answers 409. ${consistencyNote}, and the pair is re-checked against whichever half is left unchanged. status and parent_id are not updatable here`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(CashFlowDirectionEnum),
				},
				category_type: {
					type: 'enum',
					required: false,
					values: Object.values(CashFlowCategoryTypeEnum),
				},
				category: {
					type: 'enum',
					required: false,
					values: Object.values(CashFlowCategoryEnum),
				},
				method: {
					type: 'enum',
					required: false,
					values: Object.values(CashFlowMethodEnum),
				},
				amount: { ...amountParam, required: false },
				vat_rate: { ...vatRateParam, required: false },
				currency: currencyParam,
				external_reference: { type: 'string', required: false },
				notes: { type: 'string', required: false },
				operational_records: {
					type: 'object',
					required: false,
					format: operationalRecordsFormat,
					condition: operationalRecordsCondition,
				},
			},
			sample: cashFlowInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete cash flow',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cash flow deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: 'An entry with refunds answers 409 unless force is set, which deletes those refunds along with it. There is no restore route for this entity',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			query: {
				force: {
					type: 'boolean',
					required: false,
					default: false,
				},
			},
			sample: cashFlowInputPayloads.delete,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get cash flow entries',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cash flow list',
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
						term: 'REF-12345',
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'client_id and vendor_id filter through the operational records, so an entry with no record of that type is not returned',
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
					id: { type: 'number', required: false },
					parent_id: {
						type: 'number',
						required: false,
						condition: 'returns the refunds of one entry',
					},
					direction: {
						type: 'enum',
						required: false,
						values: Object.values(CashFlowDirectionEnum),
					},
					category_type: {
						type: 'enum',
						required: false,
						values: Object.values(CashFlowCategoryTypeEnum),
					},
					category: {
						type: 'enum',
						required: false,
						values: Object.values(CashFlowCategoryEnum),
					},
					method: {
						type: 'enum',
						required: false,
						values: Object.values(CashFlowMethodEnum),
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(CashFlowStatusEnum),
					},
					create_at_start: { type: 'string', required: false },
					create_at_end: { type: 'string', required: false },
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise notes and external_reference, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					client_id: { type: 'number', required: false },
					vendor_id: { type: 'number', required: false },
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: cashFlowInputPayloads.find,
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Move a cash flow entry to another status',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cash flow status updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote}`,
			params: {
				id: {
					type: 'number',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(CashFlowStatusEnum),
				},
			},
		},
	}),
	operationalRecords: helperApiInputDocumentation({
		description: 'Get the operational records linked to a cash flow entry',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Operational record list',
			// `data` is the bare array the service returns, not a wrapper object.
			dataSample: [
				{
					id: 1,
					cash_flow_id: 1,
					operational_record_type: OperationalRecordTypeEnum.CLIENT,
					entity_id: 1,
					notes: null,
					client: getClientEntityMock(),
				},
			] as unknown as Record<string, unknown>,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Each record carries the client or vendor it points at, resolved under a key named for its type. An entry holds at most one record per type',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
};
