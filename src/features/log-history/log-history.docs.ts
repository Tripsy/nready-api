import { RequestContextSourceEnum } from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import type { logHistoryController } from '@/features/log-history/log-history.controller';
import {
	getLogHistoryEntityMock,
	logHistoryInputPayloads,
} from '@/features/log-history/log-history.mock';
import { OrderByEnum } from '@/features/log-history/log-history.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { LogHistoryActionEnum } from '@/shared/types/log-history.type';

const entitySample = getLogHistoryEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * Read-only apart from the purge: rows are written by the history listener as entities change,
 * never by a caller, so there is no create and no update - and no soft delete either, the table
 * carrying no `deleted_at`.
 */
const writeNote =
	'Rows are written as entities change, one per affected id, and only while LOGGING_HISTORY routes history to the database - pointed at the logger instead, the same events go out as log lines and this table stays empty';

const entityParam = {
	type: 'string' as const,
	required: false,
	condition:
		'the table name, matched exactly - this is free text rather than an enum, so an unknown name returns nothing rather than failing',
};

export const docs: Record<
	keyof typeof logHistoryController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get one history entry',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'History entry details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `${writeNote}. The acting account is joined in, and \`performed_by\` keeps the name as it was at the time - a renamed or deleted account does not rewrite what the entry says`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Purge history entries',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Log history deleted with success',
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: 'Takes a list of ids in the body rather than one in the path - this is a purge, not the removal of a single record. Hard, since the table has no deleted state, and matching nothing answers 409 rather than reporting a success that removed no row. Nothing prunes this table on a schedule',
			body: {
				ids: {
					type: 'array',
					required: true,
					format: '[number]',
					condition: 'positive ids',
				},
			},
			sample: logHistoryInputPayloads.delete,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get history entries',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'History entry list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.RECORDED_AT,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						entity: 'user',
						entity_id: 1,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'Every filter here matches exactly - there is no search term. recorded_at_start must not be after recorded_at_end, and both are matched against recorded_at, which is stamped once per operation, so the rows of one bulk delete share it',
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
					entity: entityParam,
					entity_id: {
						type: 'string',
						required: false,
						condition:
							'only meaningful together with entity - the same id exists in every table',
					},
					action: {
						type: 'string',
						required: false,
						condition: `matched exactly, and free text rather than an enum: ${Object.values(LogHistoryActionEnum).join(', ')}`,
					},
					request_id: {
						type: 'string',
						required: false,
						condition:
							'ties together everything one request changed, across entities',
					},
					source: {
						type: 'enum',
						required: false,
						values: Object.values(RequestContextSourceEnum),
						condition:
							'where the change came from: a request, a scheduled job, or a seed',
					},
					recorded_at_start: { type: 'string', required: false },
					recorded_at_end: { type: 'string', required: false },
				},
			},
			sample: logHistoryInputPayloads.find,
		},
	}),
};
