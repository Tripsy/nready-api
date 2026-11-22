import { Configuration } from '@/config/settings.config';
import type { mailQueueController } from '@/features/mail-queue/mail-queue.controller';
import { MailQueueStatusEnum } from '@/features/mail-queue/mail-queue.entity';
import {
	getMailQueueEntityMock,
	mailQueueInputPayloads,
} from '@/features/mail-queue/mail-queue.mock';
import { OrderByEnum } from '@/features/mail-queue/mail-queue.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = getMailQueueEntityMock() as unknown as Record<
	string,
	unknown
>;

/**
 * Read-only apart from the purge: a row is written by whatever asks for a mail to go out, and
 * moved by the worker that sends it. There is no create - queueing mail is not something a caller
 * does over HTTP - no update, and no resend.
 */
const lifecycleNote = `A row lands as ${MailQueueStatusEnum.PENDING} and a job is pushed to the email queue as it is inserted; the worker sends it and writes back ${MailQueueStatusEnum.SENT}, or ${MailQueueStatusEnum.ERROR} with the message, retrying up to three times with an exponential backoff. sent_at is stamped on both outcomes, so it is when the last attempt finished rather than proof anything was delivered`;

export const docs: Record<
	keyof typeof mailQueueController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get one queued mail',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Queued mail details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: `${lifecycleNote}. \`content\` is the rendered subject, body and variables as they were queued - the template it came from can change afterwards without rewriting what was sent`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Purge queued mails',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Mail queue entries deleted with success',
		},
		withAuthErrors: true,
		withErrors: [409, 422],
		request: {
			notes: `Takes a list of ids in the body rather than one in the path - this is a purge, not the removal of a single record. Hard, since the table has no deleted state, and matching nothing answers 409 rather than reporting a success that removed no row. Nothing prunes this table on a schedule, and removing a ${MailQueueStatusEnum.PENDING} row does not cancel the job already queued for it`,
			body: {
				ids: {
					type: 'array',
					required: true,
					format: '[number]',
					condition: 'positive ids',
				},
			},
			sample: mailQueueInputPayloads.delete,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get queued mails',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Queued mail list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.SENT_AT,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						status: MailQueueStatusEnum.ERROR,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `sent_date_start must not be after sent_date_end, and both are matched against sent_at - which a ${MailQueueStatusEnum.PENDING} row has not got yet, so a date range excludes everything still waiting`,
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
					template: {
						type: 'string',
						required: false,
						condition:
							'either side of the joined template: a uuid picks one by id, any other string searches its label',
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(MailQueueStatusEnum),
					},
					content: {
						type: 'string',
						required: false,
						condition: `matched against the whole rendered payload - subject, body and variables alike - from ${Configuration.get('filter.termMinLength')} characters`,
					},
					to: {
						type: 'string',
						required: false,
						condition: `matched against the recipient name and address together, from ${Configuration.get('filter.termMinLength')} characters`,
					},
					sent_date_start: { type: 'string', required: false },
					sent_date_end: { type: 'string', required: false },
				},
			},
			sample: mailQueueInputPayloads.find,
		},
	}),
};
