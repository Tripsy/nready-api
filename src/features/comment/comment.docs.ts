import { Configuration } from '@/config/settings.config';
import type { commentController } from '@/features/comment/comment.controller';
import {
	CommentEntityTypeEnum,
	CommentStatusEnum,
	CommentTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/comment/comment.entity';
import {
	COMMENT_CONTENT_MAX,
	COMMENT_CONTENT_MIN,
	MODERATION_REASON_MAX,
	OrderByEnum,
} from '@/features/comment/comment.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * Written out rather than taken from a `comment.mock.ts`, which this feature does not have. It is
 * the moderation view: the guest's email and the moderation trail are in it, `user_ip_hash` is
 * not - that one identifies a visitor across every comment they ever left and no decision is made
 * from it, so it leaves the dashboard as little as it leaves the public read.
 */
const entitySample: Record<string, unknown> = {
	id: 12,
	entity_type: CommentEntityTypeEnum.ARTICLE,
	entity_id: 4,
	type: CommentTypeEnum.COMMENT,
	content: 'This cleared up the part I was stuck on, thanks.',
	status: CommentStatusEnum.APPROVED,
	parent_id: null,
	user_id: 7,
	guest_name: null,
	guest_email: null,
	guest_website: null,
	reply_count: 2,
	is_pinned: false,
	is_staff: false,
	edited_at: null,
	moderated_at: null,
	moderated_by: null,
	moderation_reason: null,
	created_at: '2026-08-20T09:14:00.000Z',
	updated_at: null,
};

/** Rendered as `pending -> rejected | spam | approved`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.join(' | ')}`)
	.join('; ');

export const docs: Record<
	keyof typeof commentController,
	ApiInputDocumentation
> = {
	read: helperApiInputDocumentation({
		description: 'Get comment details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Comment details',
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
		description: 'Update comment',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Comment updated successfully',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: 'Provide at least one body parameter. The target, the parent and the author are what the comment is and cannot be moved; status has its own route. Changing the text stamps edited_at, which marks the comment as edited in the thread - the marker is about the text no longer being what was posted, not about who rewrote it; a pin or a type change leaves it alone',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				content: {
					type: 'string',
					required: false,
					condition: `${COMMENT_CONTENT_MIN} to ${COMMENT_CONTENT_MAX} characters`,
				},
				type: {
					type: 'enum',
					required: false,
					values: Object.values(CommentTypeEnum),
				},
				is_pinned: { type: 'boolean', required: false },
			},
			sample: {
				content: 'Trimmed by a moderator.',
				is_pinned: true,
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete comment',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Comment deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: "Hard, and final - the table has no deleted_at, so there is no restore. The replies go with it through the parent cascade, and the ratings and complaints pointing at that subtree are cleared in the same transaction, along with the parent's reply_count",
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get comments',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Comment list',
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
						status: CommentStatusEnum.PENDING,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			notes: 'The moderation listing: every status, every target, no deleted flag because nothing here is soft-deleted. parent_id addresses one level of a thread',
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
						values: Object.values(CommentEntityTypeEnum),
					},
					entity_id: { type: 'string', required: false },
					type: {
						type: 'enum',
						required: false,
						values: Object.values(CommentTypeEnum),
					},
					status: {
						type: 'enum',
						required: false,
						values: Object.values(CommentStatusEnum),
					},
					parent_id: { type: 'string', required: false },
					user_id: { type: 'string', required: false },
					is_pinned: { type: 'boolean', required: false },
					term: {
						type: 'string',
						required: false,
						condition:
							'matched against the content and the guest name; no minimum length and no id shortcut, unlike the other listings',
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: OrderByEnum.CREATED_AT,
				direction: OrderDirectionEnum.DESC,
				filter: {
					status: CommentStatusEnum.PENDING,
				},
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Take a moderation decision on a comment',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Comment status updated with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Only these transitions are allowed: ${statusTransitionNote}. Nothing returns a comment to ${CommentStatusEnum.PENDING}. Crossing the ${CommentStatusEnum.APPROVED} boundary moves the parent's reply_count, since that counter tracks what a reader can open. The decision is stamped with the authenticated caller, never with an id from the request`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
				status: {
					type: 'enum',
					required: true,
					values: Object.values(CommentStatusEnum),
				},
			},
			body: {
				moderation_reason: {
					type: 'string',
					required: false,
					condition: `at most ${MODERATION_REASON_MAX} characters; overwritten on every decision and never shown to the author`,
				},
			},
			sample: {
				moderation_reason: 'Off topic',
			},
		},
	}),
};
