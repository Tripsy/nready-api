import { Column, CreateDateColumn, Entity, Index } from 'typeorm';
import {
	type CommentEntityType,
	CommentEntityTypeEnum,
} from '@/features/comment/comment.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export const CommentSubscriptionTypeEnum = {
	ALL: 'all', // Notified on all comments
	REPLIES_TO_ME: 'replies_to_me', // Notified on his own comment reply
	UNSUBSCRIBED: 'unsubscribed', // Unsubscribed from notifications
} as const;

export type CommentSubscriptionType =
	(typeof CommentSubscriptionTypeEnum)[keyof typeof CommentSubscriptionTypeEnum];

const ENTITY_TABLE_NAME = 'comment_subscription';

/**
 * `unsubscribed` is a state, not an absent row: a subscriber is created whenever someone comments,
 * so deleting the row on opt-out would re-subscribe them with their next comment.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
})
// Also the fan-out lookup on a new comment - it leads with (entity_type, entity_id).
// `user_email` is compared byte-for-byte, so the service lower-cases it on write; a decorator
// cannot declare the lower(user_email) expression index that would hold the rule in the schema.
@Index(
	'UQ_comment_subscription_user',
	['entity_type', 'entity_id', 'user_email'],
	{ unique: true },
)
export default class CommentSubscriptionEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	// A registered subscriber keeps `user_id` so the subscription survives an email change, but the
	// name and address stay required either way: they are what the notification is addressed to,
	// and `user_email` carries the unique index, which a NULL would silently opt the row out of.
	@Column({
		type: 'uuid',
		nullable: true,
	})
	user_id?: EntityId | null;

	@Column({
		type: 'varchar',
	})
	user_name!: string;

	@Column({
		type: 'varchar',
	})
	user_email!: string;

	// Target Entity (Polymorphic)
	@Column({
		type: 'enum',
		enum: CommentEntityTypeEnum,
		nullable: false,
	})
	entity_type!: CommentEntityType;

	@Column({
		type: 'uuid',
		nullable: false,
	})
	entity_id!: EntityId;

	/**
	 * What the notification - and the page its unsubscribe link leads to - is written in.
	 *
	 * Stored rather than resolved at send time: a guest has no account to read a language from, and
	 * the digest runs from a cron with no request behind it. It is the language of the page they
	 * commented on, refreshed on every later comment, so somebody who switches the site to another
	 * language is followed by their notifications.
	 */
	@Column({ type: 'varchar', length: 3, nullable: false })
	language!: string;

	@Column({
		type: 'enum',
		enum: CommentSubscriptionTypeEnum,
		default: CommentSubscriptionTypeEnum.ALL,
	})
	notification_type!: CommentSubscriptionType;

	/**
	 * Carried in the unsubscribe link. A guest subscriber holds no session, so this is the only
	 * credential the opt-out endpoint can authenticate them by - it is a secret, and reaches the
	 * client only through the notification email.
	 */
	@Column({
		type: 'varchar',
		length: 64,
		nullable: false,
	})
	@Index('UQ_comment_subscription_token', { unique: true })
	unsubscribe_token!: string;
}
