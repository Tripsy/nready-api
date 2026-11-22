import { Configuration } from '@/config/settings.config';
import type { complaintController } from '@/features/complaint/complaint.controller';
import {
	ComplaintEntityTypeEnum,
	ComplaintReasonEnum,
} from '@/features/complaint/complaint.entity';
import { OrderByEnum } from '@/features/complaint/complaint.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Written out rather than taken from a `complaint.mock.ts`, which this feature does not have. It
 * is the moderation view: the reporter is joined in, because a complaint is only worth as much as
 * the account standing behind it.
 */
const entitySample: Record<string, unknown> = {
	id: 8,
	entity_type: ComplaintEntityTypeEnum.COMMENT,
	entity_id: 12,
	user_id: 7,
	reason: ComplaintReasonEnum.SPAM,
	description: 'Same link posted on three articles.',
	is_resolved: false,
	resolved_at: null,
	resolved_by: null,
	created_at: '2026-08-21T11:02:00.000Z',
	updated_at: null,
	deleted_at: null,
	user: {
		id: 7,
		name: 'Ana',
		email: 'ana@example.com',
	},
};

const resolutionNote =
	'The flag and the timestamp are tied together by a check constraint, so resolving stamps resolved_at and the deciding moderator, and reopening clears both - a name against a complaint nobody has decided on reads as a decision';

export const docs: Record<
	keyof typeof complaintController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get complaint details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint details',
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
	find: helperApiInputDocumentation({
		description: 'Get complaints',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.DESC,
					limit: 5,
					page: 1,
					filter: {
						is_resolved: false,
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'Left unfiltered this lists everything; is_resolved false is the moderation queue, and the read the partial index exists for',
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
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					entity_type: {
						type: 'enum',
						required: false,
						values: Object.values(ComplaintEntityTypeEnum),
					},
					entity_id: { type: 'string', required: false },
					reason: {
						type: 'enum',
						required: false,
						values: Object.values(ComplaintReasonEnum),
					},
					user_id: {
						type: 'string',
						required: false,
						condition: 'the reporter',
					},
					resolved_by: {
						type: 'number',
						required: false,
						condition: 'the moderator who closed it',
					},
					is_resolved: { type: 'boolean', required: false },
					term: {
						type: 'string',
						required: false,
						condition:
							'matched against the description only; no minimum length and no id shortcut',
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: OrderByEnum.CREATED_AT,
				direction: OrderDirectionEnum.DESC,
				filter: {
					is_resolved: false,
				},
			},
		},
	}),
	resolve: helperApiInputDocumentation({
		description: 'Mark a complaint as resolved',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint resolved with success',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: `One endpoint per direction rather than a boolean in the body - a required boolean validates as "must be true", so the reopening half could never pass. ${resolutionNote}`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	reopen: helperApiInputDocumentation({
		description: 'Reopen a resolved complaint',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint reopened with success',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404, 422],
		request: {
			notes: resolutionNote,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Dismiss a complaint',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Soft - a dismissed complaint is still the record a disputed decision is answered from. It also releases the reporter's slot on that target, so the same reader may file again",
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore a dismissed complaint',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint restored with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: 'Brings it back into the queue. It can collide with a complaint the same reporter filed on the same target in the meantime, since the uniqueness rule counts only live rows',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
};
