import { EventEmitter } from 'node:events';
import type UserEntity from '@/features/user/user.entity';
import type { UserStatus } from '@/features/user/user.entity';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { LogHistoryAction } from '@/shared/types/log-history.type';

export type LogHistoryEventPayload = {
	entity: string;
	entity_ids: EntityId[];
	action: LogHistoryAction;
	data?: Record<string, string | number>;
};

/**
 * Rows that have just left the database for good, named the way a polymorphic target is: the table
 * they lived in and their ids.
 *
 * Everything pointing at them without a foreign key - `rating` today, anything added later -
 * cleans up from this rather than being deleted by the feature that owned the rows, which knows
 * nothing about the tables referencing it.
 *
 * `entity_type` is the table name (`CommentEntity.NAME`), which is exactly what a polymorphic
 * column stores, so a listener can match it against its own enum without either side importing
 * the other.
 *
 * Emitted for a **hard** delete only. A soft-deleted row still exists and can be restored, so
 * what points at it stays valid - an article leaving through `deleted_at` keeps its ratings.
 */
export type EntityRemovedEventPayload = {
	entity_type: string;
	entity_ids: EntityId[];
};

/**
 * A complaint has just been filed against a target, with how many separate people now stand behind
 * the live complaints on it.
 *
 * The count travels with the event rather than being looked up by the listener: counting is a
 * question about the `complaint` table, and the feature owning the target has no business reading
 * it - it only decides what its own rows do at a given number.
 *
 * `entity_type` is the table name, the way a polymorphic target is always named here.
 */
export type ComplaintFiledEventPayload = {
	entity_type: string;
	entity_id: EntityId;
	/** Distinct reporters, resolved by the rule in `ComplaintQuery.countDistinctReporters`. */
	reporters: number;
};

/**
 * A comment has just been written - whatever a moderator will make of it later.
 *
 * Only the row is named. Everything a listener needs about the author (a member's current address,
 * a guest's) is resolved from it: the comment carries `user_id` rather than an address, and the
 * address a notification goes to has to be the one the account holds when it is sent.
 */
export type CommentPostedEventPayload = {
	comment_id: EntityId;
	entity_type: string;
	entity_id: EntityId;
	/**
	 * The language the comment was written from, captured while a request still exists - the
	 * listener runs after the response and the digest runs from a cron, and neither has one.
	 */
	language: string;
};

export type UserRegisteredEventPayload = Partial<UserEntity> & {
	id: EntityId;
	name: string;
	email: string;
	language: string;
	status: UserStatus;
};

type Events = {
	history: LogHistoryEventPayload;
	entityRemoved: EntityRemovedEventPayload;
	complaintFiled: ComplaintFiledEventPayload;
	commentPosted: CommentPostedEventPayload;
	userRegistered: UserRegisteredEventPayload;
};

class TypedEmitter extends EventEmitter {
	on<K extends keyof Events>(
		event: K,
		listener: (payload: Events[K]) => void,
	) {
		return super.on(event, listener);
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]) {
		return super.emit(event, payload);
	}
}

export const eventEmitter = new TypedEmitter();
