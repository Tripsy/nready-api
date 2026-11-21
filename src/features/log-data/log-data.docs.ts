import { Configuration } from '@/config/settings.config';
import type { logDataController } from '@/features/log-data/log-data.controller';
import {
	getLogDataEntityMock,
	logDataInputPayloads,
} from '@/features/log-data/log-data.mock';
import { OrderByEnum } from '@/features/log-data/log-data.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	LogDataCategoryEnum,
	LogDataLevelEnum,
} from '@/shared/types/log-data.type';

const entitySample = getLogDataEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * Read-only apart from the purge: rows are written by the logger's database destination, never by
 * a caller, so there is no create and no update - and no soft delete either, the table carrying
 * no `deleted_at`.
 */
const writeNote = `Rows are written by the logger itself, and only for the levels the deployment persists - ${Configuration.get('logging.levelDatabase').join(' and ')} by default, with the rest going to the console, the log file and CloudWatch instead`;

export const docs: Record<
	keyof typeof logDataController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get one log entry',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Log entry details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `${writeNote}. \`pid\` names the process that wrote the line and \`request_id\` the request it belonged to, which is what ties the lines of one failure together; \`debug_stack\` carries the stack when there was one`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Purge log entries',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Log data deleted with success',
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: 'Takes a list of ids in the body rather than one in the path - this is a purge, not the removal of a single record. Hard, since the table has no deleted state, and matching nothing answers 409 rather than reporting a success that removed no row. A weekly job already drops everything older than 30 days',
			body: {
				ids: {
					type: 'array',
					required: true,
					format: '[number]',
					condition: 'positive ids',
				},
			},
			sample: logDataInputPayloads.delete,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get log entries',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Log entry list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.CREATED_AT,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						level: LogDataLevelEnum.ERROR,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `create_at_start must not be after create_at_end. The level filter accepts every level the logger knows, but only the persisted ones can ever match: ${Configuration.get('logging.levelDatabase').join(' and ')} by default`,
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
					id: { type: 'string', required: false },
					category: {
						type: 'enum',
						required: false,
						values: Object.values(LogDataCategoryEnum),
						condition: `where the line came from: ${LogDataCategoryEnum.SYSTEM} for the application itself, ${LogDataCategoryEnum.CRON} for a scheduled job, ${LogDataCategoryEnum.HISTORY} for an audit event - the last one keeps its own table and reaches this one only where history logging is routed through the logger`,
					},
					level: {
						type: 'enum',
						required: false,
						values: Object.values(LogDataLevelEnum),
					},
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise request_id and pid exactly, or the message and the JSON context by substring, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					create_at_start: { type: 'string', required: false },
					create_at_end: { type: 'string', required: false },
				},
			},
			sample: logDataInputPayloads.find,
		},
	}),
};
