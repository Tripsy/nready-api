import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type UserEntity from '@/features/user/user.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export const ComplaintEntityTypeEnum = {
	ARTICLE: 'article',
	COMMENT: 'comment',
} as const;

export type ComplaintEntityType =
	(typeof ComplaintEntityTypeEnum)[keyof typeof ComplaintEntityTypeEnum];

export const ComplaintReasonEnum = {
	SPAM: 'spam',
	OFFENSIVE: 'offensive',
	HARASSMENT: 'harassment',
	HATE_SPEECH: 'hate_speech',
	MISINFORMATION: 'misinformation',
	AI_SLOP: 'ai_slop',
	COPYRIGHT: 'copyright',
} as const;

export type ComplaintReason =
	(typeof ComplaintReasonEnum)[keyof typeof ComplaintReasonEnum];

const ENTITY_TABLE_NAME = 'complaint';

/**
 * A complaint does not outlive its target. `(entity_type, entity_id)` carries no foreign key, so
 * `ComplaintListener` clears these rows when the target announces a hard delete on `entityRemoved`
 * - there is nothing left to moderate once the thing being accused is gone.
 *
 * That covers comments, which are hard-deleted. An article leaves through `deleted_at` instead and
 * can be restored, so its complaints stay: they become answerable again the moment it comes back.
 *
 * Reviews are not a target: a review is reported by flagging it through moderation, not here.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
})
// One complaint per user per target. Scoped to live rows, so a withdrawn complaint can be filed again.
@Index('UQ_complaint_user', ['entity_type', 'entity_id', 'user_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
// Moderation queue. Partial: the open set stays small while the table only grows.
// `deleted_at IS NULL` belongs in the predicate, not only in the query - without it the index
// carries withdrawn complaints, and a queue read that excludes them cannot be answered from it.
@Index('IDX_complaint_open', ['created_at'], {
	where: 'is_resolved = false AND deleted_at IS NULL',
})
@Check('CHK_complaint_resolved', 'is_resolved = (resolved_at IS NOT NULL)')
export default class ComplaintEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	// Target Entity (Polymorphic)
	@Column({
		type: 'enum',
		enum: ComplaintEntityTypeEnum,
		nullable: false,
	})
	entity_type!: ComplaintEntityType;

	@Column({
		type: 'uuid',
		nullable: false,
	})
	entity_id!: EntityId;

	@Column('uuid', { nullable: false })
	@Index('IDX_complaint_user_id')
	user_id!: EntityId;

	@Column({
		type: 'enum',
		enum: ComplaintReasonEnum,
		nullable: false,
	})
	reason!: ComplaintReason;

	@Column('text', { nullable: true })
	description?: string | null;

	// Resolution
	// `is_resolved` is the flag the queue filters on; `resolved_at`/`resolved_by` are the audit
	// trail a disputed moderation decision is answered from. CHK_complaint_resolved keeps the flag
	// and the timestamp from drifting apart.
	@Column({
		type: 'boolean',
		default: false,
	})
	is_resolved!: boolean;

	@Column({
		type: 'timestamp',
		nullable: true,
	})
	resolved_at?: Date | null;

	@Column({
		type: 'uuid',
		nullable: true,
		comment: 'Moderator user ID',
	})
	resolved_by?: EntityId | null;

	// RELATIONS
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user!: UserEntity;
}
