import { Configuration } from '@/config/settings.config';
import {
	CommentEntityTypeEnum,
	CommentStatusEnum,
	CommentTypeEnum,
	CommentWritableEntityTypeEnum,
} from '@/features/comment/comment.entity';
import {
	COMMENT_CONTENT_MAX,
	COMMENT_CONTENT_MIN,
	GUEST_NAME_MAX,
	GUEST_NAME_MIN,
	GUEST_WEBSITE_MAX,
	OrderByEnum,
} from '@/features/comment/comment.validator';
import type { commentPublicController } from '@/features/comment/comment-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/**
 * The reader-facing half of the comment feature, mounted under `/public/comments` by
 * `comment-public.routes.ts`. Documented separately from `comment.docs.ts` because it is a route
 * module of its own - a different base path, a different controller, and no permission check -
 * even though both describe the same entity.
 *
 * The bearer token is optional throughout rather than absent: commenting is open to guests, and
 * signing in changes who the request counts as, not whether it is allowed.
 */
const publicSample: Record<string, unknown> = {
	id: 12,
	entity_type: CommentEntityTypeEnum.ARTICLE,
	entity_id: 4,
	type: CommentTypeEnum.COMMENT,
	content: 'This cleared up the part I was stuck on, thanks.',
	parent_id: null,
	user_id: 7,
	guest_name: null,
	guest_website: null,
	reply_count: 2,
	is_pinned: false,
	is_staff: false,
	edited_at: null,
	created_at: '2026-08-20T09:14:00.000Z',
	updated_at: null,
};

const authorNote =
	"The author is resolved from the request, never from the body: the signed-in account when there is one, otherwise the guest fields plus a hash of the caller address. A request whose address cannot be resolved answers 400 - that hash is a guest's only handle on their own comment";

const ownershipNote =
	"Scoped to the caller's own comment by the query that loads it, so somebody else's id answers 404 rather than 403";

export const docs: Record<
	keyof typeof commentPublicController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Post a comment',
		success: {
			status: 201,
			description: 'Comment created successfully',
			dataSample: publicSample,
		},
		withErrors: [400, 403, 404, 422],
		request: {
			notes: `${authorNote}. A member's comment is ${CommentStatusEnum.APPROVED} on arrival unless COMMENT_AUTO_APPROVE is turned off; a guest's is always ${CommentStatusEnum.PENDING}. A target that no longer takes comments answers 403, and the response message says which of the two happened`,
			body: {
				entity_type: {
					type: 'enum',
					required: true,
					values: Object.values(CommentWritableEntityTypeEnum),
					condition:
						'articles only - neither a product nor a review takes comments',
				},
				entity_id: { type: 'string', required: true },
				content: {
					type: 'string',
					required: true,
					condition: `${COMMENT_CONTENT_MIN} to ${COMMENT_CONTENT_MAX} characters`,
				},
				type: {
					type: 'enum',
					required: false,
					values: Object.values(CommentTypeEnum),
					default: CommentTypeEnum.COMMENT,
				},
				parent_id: {
					type: 'string',
					required: false,
					condition: 'the comment being replied to',
				},
				guest_name: {
					type: 'string',
					required: false,
					condition: `required when the caller is not signed in; ${GUEST_NAME_MIN} to ${GUEST_NAME_MAX} characters`,
				},
				guest_email: {
					type: 'string',
					required: false,
					condition:
						'required when the caller is not signed in; never returned by a public read',
				},
				guest_website: {
					type: 'string',
					required: false,
					condition: `free text, at most ${GUEST_WEBSITE_MAX} characters - it is displayed, never fetched`,
				},
			},
			sample: {
				entity_type: CommentEntityTypeEnum.ARTICLE,
				entity_id: 4,
				content: 'This cleared up the part I was stuck on, thanks.',
				guest_name: 'Ana',
				guest_email: 'ana@example.com',
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Locate one approved comment',
		success: {
			status: 200,
			description: 'Comment location',
			dataSample: {
				id: 12,
				entity_type: CommentEntityTypeEnum.ARTICLE,
				entity_id: 4,
				parent_id: null,
			},
		},
		withErrors: [404, 422],
		request: {
			notes: 'Deliberately thin - the target and the parent, which is what a link in an email needs to build the page address and the anchor inside it. A comment that is not approved is not found',
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Edit your own comment',
		success: {
			status: 200,
			description: 'Comment updated successfully',
			dataSample: publicSample,
		},
		withErrors: [400, 404, 422],
		request: {
			notes: `Only the text moves - the target, the parent and the type are what the comment is. Open while the comment is ${CommentStatusEnum.PENDING} or ${CommentStatusEnum.APPROVED} and refused once a moderator has acted on it. The edit stamps edited_at, which is what marks the comment as edited in the thread. ${ownershipNote}`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
			body: {
				content: {
					type: 'string',
					required: true,
					condition: `${COMMENT_CONTENT_MIN} to ${COMMENT_CONTENT_MAX} characters`,
				},
			},
			sample: {
				content: 'Edited: the second step is the one that mattered.',
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Withdraw your own comment',
		success: {
			status: 200,
			description: 'Comment deleted with success',
		},
		withErrors: [404, 422],
		request: {
			notes: `Hard, and it takes the replies with it. ${ownershipNote}`,
			params: {
				id: {
					type: 'string',
					required: true,
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Read one level of a thread',
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
				first_replies: {},
			},
		},
		withErrors: [422],
		request: {
			notes: `Approved rows only - there is no status filter here, and one would expose the moderation queue. The target comes from the path and parent_id picks the level: omitted reads the roots, an id reads the replies under it. A roots read also carries first_replies, one reply per root that has any, so a thread renders without a request per root. Cached per target, page and ordering, and dropped whenever a write changes what a reader would see`,
			params: {
				entity_type: {
					type: 'enum',
					required: true,
					values: Object.values(CommentEntityTypeEnum),
				},
				entity_id: { type: 'string', required: true },
			},
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
					default: OrderByEnum.CREATED_AT,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					parent_id: { type: 'string', required: false },
					type: {
						type: 'enum',
						required: false,
						values: Object.values(CommentTypeEnum),
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				filter: {
					type: CommentTypeEnum.QUESTION,
				},
			},
		},
	}),
};
