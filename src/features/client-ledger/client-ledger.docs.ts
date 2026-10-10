import type { clientLedgerController } from '@/features/client-ledger/client-ledger.controller';
import { ClientLedgerEntryTypeEnum } from '@/features/client-ledger/client-ledger.entity';
import { OrderByEnum } from '@/features/client-ledger/client-ledger.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const clientIdParam = {
	type: 'number' as const,
	required: true,
	condition: 'the client id',
};

const signNote =
	'amounts are signed: positive, money received from the client (a payment); negative, money paid back to them (a refund)';

export const docs: Record<
	keyof typeof clientLedgerController,
	ApiInputDocumentation
> = {
	balance: helperApiInputDocumentation({
		description: 'Read the money moved with a client, one row per currency',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Client balance',
			dataSample: {
				client_id: 1,
				balances: [
					{
						currency: 'RON',
						received: 1210,
						refunded: 210,
						net: 1000,
						net_base: 1000,
					},
				],
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `net is received - refunded: the money that changed hands with the client, from completed movements only - not a debt. Never summed across currencies - net_base converts each entry at the rate it froze, for reporting. ${signNote}`,
			params: {
				client_id: clientIdParam,
			},
		},
	}),

	find: helperApiInputDocumentation({
		description: 'List the money moved with a client',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Ledger entries',
			dataSample: {
				entries: [
					{
						id: 1,
						client_id: 1,
						entry_type: ClientLedgerEntryTypeEnum.PAYMENT,
						cash_flow_id: 1,
						currency: 'RON',
						amount: 1210,
						exchange_rate: 1,
						amount_base: 1210,
						occurred_at: '2026-10-01T10:00:00.000Z',
					},
				],
				pagination: { page: 1, limit: 10, total: 1 },
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `Append-only: one entry per completed cash flow filed under the client (a refund under the client of the payment it returns), never changed. A movement still pending, failed or canceled writes nothing. ${signNote}`,
			params: {
				client_id: clientIdParam,
			},
			query: {
				page: { type: 'number', required: false },
				limit: { type: 'number', required: false },
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
				},
				'filter[entry_type]': {
					type: 'enum',
					required: false,
					values: Object.values(ClientLedgerEntryTypeEnum),
				},
				'filter[currency]': { type: 'string', required: false },
				'filter[cash_flow_id]': { type: 'number', required: false },
				'filter[occurred_at_start]': {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
				'filter[occurred_at_end]': {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
			},
		},
	}),
};
