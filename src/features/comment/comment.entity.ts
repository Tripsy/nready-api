import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	UpdateDateColumn,
} from 'typeorm';
import type UserEntity from '@/features/user/user.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * What a comment can hang from. `article` is the only one in use: a product is not a target, and
 * neither is a review - a review is one buyer's statement about a product, moderated and scored on
 * its own, not a thread other readers reply to.
 *
 * `review` stays in the enum because dropping a value from a Postgres enum means recreating the
 * type, and nothing writes it. Reading it as available is a mistake: the storefront renders no
 * comment section on a review, and no feature registers a participation resolver for one.
 */
export const CommentEntityTypeEnum = {
	ARTICLE: 'article',
	REVIEW: 'review',
} as const;

export type CommentEntityType =
	(typeof CommentEntityTypeEnum)[keyof typeof CommentEntityTypeEnum];

/**
 * The targets a *new* comment may name. Narrower than the enum above, which stays as the column's
 * full domain - reads, filters and any row already written keep working against it - while a write
 * is refused for anything not listed here.
 *
 * Without this the public `create` would accept `review` and store a comment nobody can reach:
 * `entity_type`/`entity_id` carries no foreign key, and no participation resolver answers for a
 * review, so an unreachable id is not caught anywhere else either.
 */
export const CommentWritableEntityTypeEnum = {
	ARTICLE: CommentEntityTypeEnum.ARTICLE,
} as const;

export const CommentStatusEnum = {
	PENDING: 'pending', // Awaiting moderation
	REJECTED: 'rejected', // Rejected by moderator
	SPAM: 'spam', // Marked as spam
	APPROVED: 'approved', // Visible to public
	FLAGGED: 'flagged', // Reported by users
} as const;

export type CommentStatus =
	(typeof CommentStatusEnum)[keyof typeof CommentStatusEnum];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<CommentStatus> = {
	[CommentStatusEnum.PENDING]: [
		CommentStatusEnum.REJECTED,
		CommentStatusEnum.SPAM,
		CommentStatusEnum.APPROVED,
	],
	[CommentStatusEnum.REJECTED]: [CommentStatusEnum.APPROVED],
	[CommentStatusEnum.SPAM]: [
		CommentStatusEnum.REJECTED,
		CommentStatusEnum.APPROVED,
	],
	[CommentStatusEnum.APPROVED]: [
		CommentStatusEnum.FLAGGED,
		CommentStatusEnum.REJECTED,
		CommentStatusEnum.SPAM,
	],
	[CommentStatusEnum.FLAGGED]: [
		CommentStatusEnum.REJECTED,
		CommentStatusEnum.SPAM,
		CommentStatusEnum.APPROVED,
	],
};

export const CommentTypeEnum = {
	COMMENT: 'comment', // Regular comment
	QUESTION: 'question', // Question
	TIP: 'tip', // Helpful tip / note
} as const;

export type CommentType =
	(typeof CommentTypeEnum)[keyof typeof CommentTypeEnum];

const ENTITY_TABLE_NAME = 'comment';

/**
 * Comments are hard-deleted - no `deleted_at`, so `EntityAbstract` is not the base here - and
 * `parent_id` cascades so a subtree goes with its root. `rating` and `complaint` point at comments
 * polymorphically, with no foreign key to carry that cascade: `CommentService` resolves the subtree
 * and clears them, along with the parent's `reply_count`, in the same transaction which performs
 * the `delete` operation.
 *
 * The target (`entity_type` + `entity_id`) has no foreign key either, so an article that goes away
 * leaves its comments behind for the same service call, or for the orphan sweep.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores user comments on articles and replies to reviews',
})
/**
 * The thread read, which is the hottest query on this table: one target, the approved rows only,
 * one level of the tree at a time - `parent_id IS NULL` for the roots, `parent_id = ?` for the
 * replies under one of them - newest first.
 *
 * `type` is not in it. Three values over a table dominated by `comment` buy almost no selectivity,
 * and sitting between the target and `status` they would have cost every thread read the ordering
 * this index exists to provide.
 */
@Index('IDX_comment_entity', [
	'entity_type',
	'entity_id',
	'status',
	'parent_id',
	'created_at',
])
// Moderation queue. Partial: only `pending` rows are ever listed this way, and the table is
// dominated by rows that have already left that state.
@Index('IDX_comment_moderation', ['created_at'], {
	where: `status = 'pending'`,
})
// One author's history, which the dashboard lists newest first - the trailing `created_at` is what
// keeps that ordering inside the index scan.
@Index('IDX_comment_user_status', ['user_id', 'status', 'created_at'])
@Index('IDX_comment_user_ip_hash', ['user_ip_hash', 'created_at'])
@Check(
	'CHK_comment_author',
	`user_id IS NOT NULL OR (guest_name IS NOT NULL AND guest_email IS NOT NULL)`,
)
export default class CommentEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

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

	@Column({
		type: 'enum',
		enum: CommentTypeEnum,
		default: CommentTypeEnum.COMMENT,
		nullable: false,
	})
	type!: CommentType;

	@Column({
		type: 'text',
		nullable: false,
	})
	content!: string;

	/**
	 * When the text was last rewritten, and null for a comment nobody has touched since posting.
	 *
	 * A column of its own rather than a comparison against `updated_at`: that one moves for every
	 * save on the row - a moderation decision, a pin - so reading it as "edited" would put the
	 * marker on comments whose author never went back to them. Written only where `content`
	 * actually changes.
	 */
	@Column({
		type: 'timestamp',
		nullable: true,
	})
	edited_at?: Date | null;

	@Column({
		type: 'enum',
		enum: CommentStatusEnum,
		default: CommentStatusEnum.PENDING,
		nullable: false,
	})
	status!: CommentStatus;

	@Column({
		type: 'uuid',
		nullable: true,
		comment: 'Parent comment ID',
	})
	@Index('IDX_comment_parent_id')
	parent_id?: EntityId | null;

	// Author
	@Column({
		type: 'uuid',
		nullable: true,
	})
	user_id?: EntityId | null;

	@Column({
		type: 'varchar',
		comment: 'Recorded IP address (hashed for privacy)',
	})
	user_ip_hash!: string;

	@Column({
		type: 'varchar',
		nullable: true,
		comment: 'Guest commenter name if not logged in',
	})
	guest_name?: string | null;

	@Column({
		type: 'varchar',
		nullable: true,
		comment: 'Guest commenter email',
	})
	guest_email?: string | null;

	@Column({
		type: 'varchar',
		nullable: true,
		comment: 'Guest commenter website',
	})
	guest_website?: string | null;

	// Direct replies only - a subtree count would have to be walked up the whole ancestor chain on
	// every write, while this one moves by 1 for a single parent.
	@Column({
		type: 'int',
		default: 0,
	})
	reply_count!: number;

	// Flags
	@Column({
		type: 'boolean',
		default: false,
	})
	is_pinned!: boolean;

	@Column({
		type: 'boolean',
		default: false,
		comment: 'Staff/administrator comment',
	})
	is_staff!: boolean;

	// Moderation
	@Column({
		type: 'timestamp',
		nullable: true,
	})
	moderated_at?: Date | null;

	@Column({
		type: 'uuid',
		nullable: true,
		comment: 'Moderator user ID',
	})
	moderated_by?: EntityId | null;

	@Column({
		type: 'varchar',
		nullable: true,
		comment: 'Reason for moderation action',
	})
	moderation_reason?: string | null;

	/**
	 * When this comment went out in a subscriber digest, so the four-hourly run does not send it
	 * twice. Null means "not yet announced", which is what the run selects on - and what a comment
	 * approved but never notified stays until it is.
	 *
	 * Stamped whether or not anybody was notified: a target with no subscribers still has to leave
	 * the queue, or every run re-scans it forever.
	 */
	@Column({
		type: 'timestamp',
		nullable: true,
	})
	@Index('IDX_comment_notify_pending', {
		where: `status = 'approved' AND notified_at IS NULL`,
	})
	notified_at?: Date | null;

	// RELATIONS
	@ManyToOne('CommentEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'parent_id' })
	parent?: CommentEntity;

	@ManyToOne('UserEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity;
}
