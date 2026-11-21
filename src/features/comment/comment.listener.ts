import {
	type CommentPostedEventPayload,
	type ComplaintFiledEventPayload,
	type EntityRemovedEventPayload,
	eventEmitter,
} from '@/config/event.config';
import type { CommentEntityType } from '@/features/comment/comment.entity';
import CommentEntity, {
	CommentEntityTypeEnum,
} from '@/features/comment/comment.entity';
import { commentService } from '@/features/comment/comment.service';
import { commentSubscriptionService } from '@/features/comment/comment-subscription.service';
import { runInBackground } from '@/helpers/background.helper';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Follows the discussion on behalf of whoever just wrote in it.
 *
 * A listener rather than a step inside `create`: whether commenting also means subscribing is a
 * policy about notifications, and a failure to record it must not fail the comment somebody has
 * just written. `subscribe` is insert-or-ignore, so a second comment on the same discussion - and
 * a comment from somebody who has since opted out - leaves the existing row alone.
 */
const COMMENT_ENTITY_TYPES: readonly string[] = Object.values(
	CommentEntityTypeEnum,
);

/**
 * Whether a discussion can hang off the announced target at all.
 *
 * `entityRemoved` is broadcast for every table that hard-deletes, so most of what arrives here
 * concerns rows nobody ever commented on. A predicate rather than a cast: it narrows the payload's
 * plain table name to the enum the service takes, and the same check that decides to act is the one
 * that proves the type.
 */
function isCommentTarget(entityType: string): entityType is CommentEntityType {
	return COMMENT_ENTITY_TYPES.includes(entityType);
}

/**
 * Clears the discussion on targets that have just been hard-deleted - the comments and the
 * subscriptions to them alike.
 *
 * Roots only, one target at a time: `deleteByTarget` walks each root's subtree, and the replies
 * follow through the cascade. The subscriptions go in the same pass because they are keyed by the
 * same target and nothing else would ever remove them - a subscriber would otherwise keep a live
 * unsubscribe token for a discussion that no longer exists.
 */
async function clearTargets(
	entityType: CommentEntityType,
	entityIds: EntityId[],
): Promise<void> {
	for (const entityId of entityIds) {
		await commentService.deleteByTarget(entityType, entityId);
	}

	await commentSubscriptionService.deleteByTargets(entityType, entityIds);
}

async function subscribeAuthor(
	commentId: EntityId,
	language: string,
): Promise<void> {
	const entry = await commentService.findById(commentId);
	const identity = await commentSubscriptionService.resolveIdentity(entry);

	if (!identity) {
		return;
	}

	await commentSubscriptionService.subscribe(
		entry.entity_type,
		entry.entity_id,
		identity,
		language,
	);
}

/**
 * What this feature does in reaction to something announced elsewhere: subscribe an author to the
 * discussion they just wrote in, clear a discussion whose target has been hard-deleted, and take a
 * comment out of the thread once enough separate readers have reported it.
 *
 * The rule lives here rather than in `complaint` because it is a rule about comments: what a
 * count of reports means, and what a comment does about it, is this feature's business. All the
 * event carries is the count - `complaint` knows how to count reporters, and nothing else.
 *
 * Fire-and-forget through `runInBackground`, so a failed flag logs instead of rejecting into
 * `server.ts`'s `unhandledRejection` handler, which would shut the API down. The complaints
 * themselves are already stored and sitting in the moderation queue, so nothing is lost when this
 * fails - the comment simply stays up until somebody acts on them.
 */
export default function registerCommentListener() {
	eventEmitter.on('commentPosted', (payload: CommentPostedEventPayload) => {
		runInBackground(
			subscribeAuthor(payload.comment_id, payload.language),
			`Failed to subscribe the author of comment ${payload.comment_id}`,
		);
	});

	eventEmitter.on('entityRemoved', (payload: EntityRemovedEventPayload) => {
		if (!isCommentTarget(payload.entity_type)) {
			return;
		}

		runInBackground(
			clearTargets(payload.entity_type, payload.entity_ids),
			`Failed to remove the comments for ${payload.entity_type}(s) ${payload.entity_ids.join(', ')}`,
		);
	});

	eventEmitter.on('complaintFiled', (payload: ComplaintFiledEventPayload) => {
		if (payload.entity_type !== CommentEntity.NAME) {
			return;
		}

		runInBackground(
			commentService.flagWhenReported(
				payload.entity_id,
				payload.reporters,
			),
			`Failed to flag comment ${payload.entity_id} after ${payload.reporters} report(s)`,
		);
	});
}
