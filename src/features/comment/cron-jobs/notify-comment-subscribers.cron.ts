import type CommentEntity from '@/features/comment/comment.entity';
import { CommentStatusEnum } from '@/features/comment/comment.entity';
import { getCommentRepository } from '@/features/comment/comment.repository';
import { commentService } from '@/features/comment/comment.service';
import { commentEmailService } from '@/features/comment/comment-email.service';
import { CommentSubscriptionTypeEnum } from '@/features/comment/comment-subscription.entity';
import { commentSubscriptionService } from '@/features/comment/comment-subscription.service';
import type { EntityId } from '@/shared/types/entity-id.type';

export const SCHEDULE_EXPRESSION = '0 */4 * * *';
export const EXPECTED_RUN_TIME = 30; // seconds

/**
 * How many comments one run answers for. The rest wait for the next one - the queue only grows
 * this far behind if a discussion outran four hours of moderation, and a run that fans out an
 * unbounded batch is one that holds a connection for as long as the backlog takes.
 */
const BATCH_LIMIT = 500;

/** The columns the digest reads. `user_ip_hash` and the moderation trail are none of its business. */
const DIGEST_COLUMNS: string[] = [
	'comment.id',
	'comment.entity_type',
	'comment.entity_id',
	'comment.parent_id',
	'comment.content',
	'comment.created_at',
	'comment.guest_email',
	'comment.guest_name',
	'user.id',
	'user.name',
	'user.email',
];

/** Who wrote a comment, as the subscription table stores an address: lower-cased, or null. */
function authorEmail(entry: CommentEntity): string | null {
	return (entry.user?.email ?? entry.guest_email)?.toLowerCase() ?? null;
}

function targetKey(entry: CommentEntity): string {
	return `${entry.entity_type}:${entry.entity_id}`;
}

/**
 * The four-hourly digest: every comment approved since the last run, sent on to the people
 * following the discussion it landed in.
 *
 * On a schedule rather than on approval, and that is a deliberate trade. A discussion that gets
 * five comments in an afternoon costs a subscriber one email instead of five, and a moderator
 * approving a backlog in one sitting does not turn into a burst of notifications. The cost is
 * up to four hours of lag on a reply, which is the right way round for a discussion nobody is
 * watching live.
 *
 * Notification follows **approval**, unlike the subscription itself: a pending comment is not
 * public, and announcing it would leak what a moderator has not passed. `notified_at` is what
 * separates the two - a comment enters this queue when it is approved and leaves it when the run
 * has answered for it, whether or not anybody was actually written to.
 */
const notifyCommentSubscribers = async () => {
	const entries = await getCommentRepository()
		.createQuery()
		.join('comment.user', 'user', 'LEFT')
		.select(DIGEST_COLUMNS)
		.filterBy('comment.status', CommentStatusEnum.APPROVED)
		.filterRaw('comment.notified_at IS NULL')
		// Oldest first, so a backlog longer than one batch is worked through in the order it
		// was written rather than newest-first with the tail never reached.
		.orderBy('comment.created_at', 'ASC')
		.pagination(1, BATCH_LIMIT)
		.all();

	if (!entries.length) {
		return { comments: 0, subscribers: 0, emails: 0 };
	}

	/*
	 * The authors of the comments being answered, which is what `replies_to_me` is matched on.
	 * Loaded in one go for the whole batch: a per-comment lookup would be a query per reply.
	 */
	const parentIds = [
		...new Set(
			entries
				.map((entry) => entry.parent_id)
				.filter((parentId): parentId is EntityId => Boolean(parentId)),
		),
	];

	const parents = parentIds.length
		? await getCommentRepository()
				.createQuery()
				.join('comment.user', 'user', 'LEFT')
				.select(DIGEST_COLUMNS)
				.filterBy('comment.id', parentIds, 'IN')
				.all()
		: [];

	const parentAuthors = new Map<EntityId, string | null>(
		parents.map((parent) => [parent.id, authorEmail(parent)]),
	);

	const byTarget = new Map<string, CommentEntity[]>();

	for (const entry of entries) {
		const key = targetKey(entry);

		byTarget.set(key, [...(byTarget.get(key) ?? []), entry]);
	}

	let subscribersReached = 0;
	let emails = 0;

	for (const group of byTarget.values()) {
		const [first] = group;

		const subscribers = await commentSubscriptionService.findSubscribers(
			first.entity_type,
			first.entity_id,
		);

		for (const subscriber of subscribers) {
			const forSubscriber = group.filter((entry) => {
				// Nobody is told about their own comment, whichever subscription they hold.
				if (authorEmail(entry) === subscriber.user_email) {
					return false;
				}

				if (
					subscriber.notification_type ===
					CommentSubscriptionTypeEnum.ALL
				) {
					return true;
				}

				// `replies_to_me`: only the answers to something this subscriber wrote. A root
				// comment answers nobody, so it never qualifies.
				return entry.parent_id
					? parentAuthors.get(entry.parent_id) ===
							subscriber.user_email
					: false;
			});

			if (!forSubscriber.length) {
				continue;
			}

			subscribersReached++;

			await commentEmailService.sendCommentNotification(
				subscriber,
				forSubscriber,
			);

			emails++;
		}
	}

	/*
	 * Stamped for the whole batch, including the comments nobody was written about: a discussion
	 * with no subscribers would otherwise be re-scanned by every run from now on.
	 */
	await commentService.markNotified(entries.map((entry) => entry.id));

	return {
		comments: entries.length,
		subscribers: subscribersReached,
		emails,
	};
};

export default notifyCommentSubscribers;
