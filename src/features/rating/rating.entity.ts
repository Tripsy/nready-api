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
import type { EntityId } from '@/shared/types/entity-id.type';

export const RatingEntityTypeEnum = {
	ARTICLE: 'article',
	COMMENT: 'comment',
} as const;

export type RatingEntityType =
	(typeof RatingEntityTypeEnum)[keyof typeof RatingEntityTypeEnum];

export const RatingTypeEnum = {
	LIKE: 'like', // Saved as value: 1 or -1
	STARS: 'stars', // Saved as value: 1-5
	EMOJI: 'emoji', // Saved as reaction
} as const;

export type RatingType = (typeof RatingTypeEnum)[keyof typeof RatingTypeEnum];

export const RatingEmojiEnum = {
	LIKE: 'like',
	DISLIKE: 'dislike',
	LOVE: 'love',
	INSIGHTFUL: 'insightful',
	FUNNY: 'funny',
} as const;

export type RatingEmoji =
	(typeof RatingEmojiEnum)[keyof typeof RatingEmojiEnum];

const ENTITY_TABLE_NAME = 'rating';

/**
 * A row is the rating a visitor currently holds on one target, not a record of the moment they
 * cast it: the uniques below allow exactly one per owner per `(target, type)`, so a reader who
 * changes their mind edits that row rather than adding another. `created_at` is when they first
 * rated, `updated_at` when they last changed it.
 *
 * Deliberately **not** `EntityAbstract`: this table has no `deleted_at`. A withdrawn rating has to
 * leave the table outright - a soft-deleted row goes on holding its slot under both uniques, so
 * nobody at that address could ever rate the target again, and it would keep counting in the
 * aggregates. Both deletes are therefore hard, and there is no `restore` to pair with them.
 *
 * `type` is not editable. It sits in both uniques and decides which of `value` / `reaction` the
 * row carries, so a reader moving from stars to a like is casting a different rating, not
 * changing this one.
 *
 * A rating is rationed twice over - once per origin address and once per account - so both uniques
 * have to be reckoned with on write: an insert can collide on either, and the two say different
 * things to the caller ("you already rated this" against "this address already has").
 *
 * `user_ip_hash` is required on every row, signed in or not. A request whose address cannot be
 * resolved is rejected rather than stored under a fallback hash, which would collapse every such
 * request into a single shared vote per target.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
})
// One rating per target per origin, signed in or not: the address is what is actually being
// rationed, so a second account does not buy a second vote. Two people sharing an address - a
// household, an office, a mobile carrier's NAT - get one vote between them, which is the cost of
// counting by origin rather than by identity.
@Index('UQ_rating_ip', ['entity_type', 'entity_id', 'type', 'user_ip_hash'], {
	unique: true,
})
// And one per account whatever the address, which the index above does not imply: the same user
// rating from a phone and then a laptop arrives under two different hashes. Partial, because
// Postgres counts NULL `user_id` values as distinct and would let every guest row through anyway.
@Index('UQ_rating_user', ['entity_type', 'entity_id', 'type', 'user_id'], {
	unique: true,
	where: 'user_id IS NOT NULL',
})
// Aggregates read members and guests together, which the partial unique above cannot serve:
// Postgres picks a partial index only when the query implies its predicate.
@Index('IDX_rating_entity', ['entity_type', 'entity_id', 'type'])
@Check('CHK_rating_reaction', `(type = 'emoji') = (reaction IS NOT NULL)`)
@Check('CHK_rating_value', `(type = 'emoji') = (value IS NULL)`)
@Check('CHK_rating_like_range', `type <> 'like' OR value IN (-1, 1)`)
@Check('CHK_rating_stars_range', `type <> 'stars' OR value BETWEEN 1 AND 5`)
export default class RatingEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	// Target Entity (Polymorphic)
	@Column({
		type: 'enum',
		enum: RatingEntityTypeEnum,
		nullable: false,
	})
	entity_type!: RatingEntityType;

	@Column({
		type: 'enum',
		enum: RatingTypeEnum,
		nullable: false,
	})
	type!: RatingType;

	@Column({
		type: 'uuid',
		nullable: false,
	})
	entity_id!: EntityId;

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
		type: 'int',
		nullable: true,
	})
	value?: number | null;

	@Column({ type: 'enum', enum: RatingEmojiEnum, nullable: true })
	reaction?: RatingEmoji | null;

	// RELATIONS
	// Cascade rather than SET NULL: nulling `user_id` does not remove the rating, it turns a
	// member's vote into a guest one that keeps counting in every aggregate - and the row goes on
	// holding its slot under `UQ_rating_ip`, so nobody at that address can rate the target again.
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity;
}
