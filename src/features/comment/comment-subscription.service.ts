import { randomBytes } from 'node:crypto';
import { lang } from '@/config/message.setup';
import { NotFoundError } from '@/exceptions';
import type CommentEntity from '@/features/comment/comment.entity';
import type { CommentEntityType } from '@/features/comment/comment.entity';
import CommentSubscriptionEntity, {
	type CommentSubscriptionType,
	CommentSubscriptionTypeEnum,
} from '@/features/comment/comment-subscription.entity';
import { getCommentSubscriptionRepository } from '@/features/comment/comment-subscription.repository';
import { userService } from '@/features/user/user.service';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Who a subscription is addressed to. Resolved from the comment that created it: a member's name
 * and address come from their account, a guest's from what they signed the comment with.
 */
type SubscriberIdentity = {
	user_id: EntityId | null;
	name: string;
	email: string;
};

export class CommentSubscriptionService {
	constructor(
		private repository: ReturnType<typeof getCommentSubscriptionRepository>,
	) {}

	/**
	 * The credential the unsubscribe link carries. 32 random bytes as hex - the column is sized
	 * for exactly that - rather than the `uuid()` the recovery flow uses: this one is a bearer
	 * secret with no expiry and no second factor behind it, so it is worth the wider keyspace.
	 */
	private static createToken(): string {
		return randomBytes(32).toString('hex');
	}

	/**
	 * Follows the discussion on behalf of whoever just commented on it.
	 *
	 * Insert-or-ignore against `UQ_comment_subscription_user`, which is the whole point:
	 * `unsubscribed` is a state rather than an absent row, so somebody who opted out and then
	 * commented again keeps their choice. A second comment on a discussion they already follow
	 * likewise leaves the row - and its token - alone.
	 *
	 * The address is lower-cased on write because that unique compares it byte-for-byte, and a
	 * decorator cannot declare the `lower(user_email)` expression index that would hold the rule
	 * in the schema.
	 */
	public async subscribe(
		entityType: CommentEntityType,
		entityId: EntityId,
		identity: SubscriberIdentity,
		language: string,
	): Promise<void> {
		await this.repository
			.createQueryBuilder()
			.insert()
			.into(CommentSubscriptionEntity)
			.values({
				entity_type: entityType,
				entity_id: entityId,
				user_id: identity.user_id,
				user_name: identity.name,
				user_email: identity.email.toLowerCase(),
				language,
				notification_type: CommentSubscriptionTypeEnum.ALL,
				unsubscribe_token: CommentSubscriptionService.createToken(),
			})
			/*
			 * `language` alone on conflict - everything else about an existing row is the
			 * subscriber's own doing and must survive: their `notification_type` (opting out is
			 * the whole reason this is not an insert-or-nothing), and their token, which is live
			 * in every notification already sent. The language is the exception because it is
			 * not a choice they made here - it is where they are reading, and following that is
			 * the point of storing it.
			 */
			.orUpdate(['language'], ['entity_type', 'entity_id', 'user_email'])
			.execute();
	}

	/**
	 * The identity behind a comment, or null when there is nobody to write to.
	 *
	 * A member is looked up rather than trusted from the row: the comment carries only `user_id`,
	 * and the address a notification goes to has to be the one the account holds *now*.
	 *
	 * Null for a comment that names neither - the table forbids it (`CHK_comment_author`), so this
	 * is the deleted-account case rather than an expected one.
	 */
	public async resolveIdentity(
		entry: CommentEntity,
	): Promise<SubscriberIdentity | null> {
		if (entry.user_id) {
			const user = await userService
				.findById(entry.user_id)
				.catch(() => null);

			return user
				? { user_id: user.id, name: user.name, email: user.email }
				: null;
		}

		if (entry.guest_name && entry.guest_email) {
			return {
				user_id: null,
				name: entry.guest_name,
				email: entry.guest_email,
			};
		}

		return null;
	}

	/** Everyone still listening to one discussion. */
	public findSubscribers(
		entityType: CommentEntityType,
		entityId: EntityId,
	): Promise<CommentSubscriptionEntity[]> {
		return (
			this.repository
				.createQuery()
				.filterBy('entity_type', entityType)
				.filterBy('entity_id', entityId)
				// Everyone who still wants to hear about the target.
				.filterBy(
					'notification_type',
					CommentSubscriptionTypeEnum.UNSUBSCRIBED,
					'!=',
				)
				.all()
		);
	}

	/**
	 * @description Used by the public endpoints, which the token alone authenticates
	 *
	 * A wrong or spent token is a 404 rather than a 403: there is nothing to tell the holder of a
	 * token about a row it does not open.
	 */
	public async findByToken(
		token: string,
	): Promise<CommentSubscriptionEntity> {
		const entry = await this.repository
			.createQuery()
			.filterBy('unsubscribe_token', token)
			.first();

		if (!entry) {
			throw new NotFoundError(
				lang('comment.error.subscription_not_found'),
			);
		}

		return entry;
	}

	/**
	 * @description Used in `update` method from the public controller
	 *
	 * Changes what a subscriber hears about - including opting out, which is `unsubscribed` and
	 * not a delete: the row is what stops their next comment from re-subscribing them.
	 */
	/**
	 * The subscriptions to a discussion that no longer exists. `(entity_type, entity_id)` carries
	 * no foreign key, so nothing removes them when the article they follow is hard deleted - the
	 * comment listener does, off `entityRemoved`.
	 *
	 * A hard delete here, not a state change: `unsubscribed` exists to stop a *future* comment
	 * from re-subscribing somebody, and there is nothing left to comment on.
	 */
	public async deleteByTargets(
		entityType: CommentEntityType,
		entityIds: EntityId[],
	): Promise<void> {
		if (!entityIds.length) {
			return;
		}

		await this.repository
			.createQuery()
			.filterBy('entity_type', entityType)
			.filterBy('entity_id', entityIds, 'IN')
			.delete(false, true);
	}

	public async updateType(
		token: string,
		notificationType: CommentSubscriptionType,
	): Promise<CommentSubscriptionEntity> {
		const entry = await this.findByToken(token);

		entry.notification_type = notificationType;

		return this.repository.save(entry);
	}
}

export const commentSubscriptionService = new CommentSubscriptionService(
	getCommentSubscriptionRepository(),
);
