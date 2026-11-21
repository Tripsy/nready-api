import { Configuration } from '@/config/settings.config';
import type { cronHistoryController } from '@/features/cron-history/cron-history.controller';
import { CronHistoryStatusEnum } from '@/features/cron-history/cron-history.entity';
import {
	cronHistoryInputPayloads,
	getCronHistoryEntityMock,
} from '@/features/cron-history/cron-history.mock';
import { OrderByEnum } from '@/features/cron-history/cron-history.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getCronHistoryEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * Read-only apart from the purge: rows are written by `cron.provider.ts` around every scheduled
 * run, never by a caller, so there is no create and no update - and no soft delete either, the
 * table carrying no `deleted_at`.
 */
const writeNote = `Rows are written by the runner itself: ${CronHistoryStatusEnum.OK} when the job returns, ${CronHistoryStatusEnum.ERROR} when it throws, and ${CronHistoryStatusEnum.WARNING} when a run that did not fail took longer than the job declares as its expected run time`;

export const docs: Record<
	keyof typeof cronHistoryController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get one cron run',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cron run details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `${writeNote}. \`content\` is whatever the job returned, or the error message when it threw`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Purge cron runs',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cron history deleted with success',
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: 'Takes a list of ids in the body rather than one in the path - this is a purge, not the removal of a single record. Hard, since the table has no deleted state, and matching nothing answers 409 rather than reporting a success that removed no row. A weekly job already drops every run older than 90 days, which is longer than the other cleanups keep: this table is what the error and warning digests report from',
			body: {
				ids: {
					type: 'array',
					required: true,
					format: '[number]',
					condition: 'positive ids',
				},
			},
			sample: cronHistoryInputPayloads.delete,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get cron runs',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Cron run list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.START_AT,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						status: CronHistoryStatusEnum.ERROR,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'start_date_start must not be after start_date_end. Both are matched against start_at, which is when the run began',
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
					term: {
						type: 'string',
						required: false,
						condition: `an all-digit term matches the id exactly; otherwise the label and the JSON content, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(CronHistoryStatusEnum),
					},
					start_date_start: { type: 'string', required: false },
					start_date_end: { type: 'string', required: false },
				},
			},
			sample: cronHistoryInputPayloads.find,
		},
	}),
};
