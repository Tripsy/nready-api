import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
} from 'typeorm';
import type UserEntity from '@/features/user/user.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export const AccountIdentityProviderEnum = {
	GOOGLE: 'google',
	FACEBOOK: 'facebook',
} as const;

export type AccountIdentityProvider =
	(typeof AccountIdentityProviderEnum)[keyof typeof AccountIdentityProviderEnum];

const ENTITY_TABLE_NAME = 'account_identity';

/*
 * A row per (user, provider) pair rather than columns on `user`: a user may sign in with
 * Google today and link Facebook later, and the provider's subject id is the only stable
 * join key - an email can change on either side.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'system',
	comment: 'Links a user to an external identity provider (social sign-in)',
})
// The subject id is unique per provider, not globally - both columns are needed.
@Index(
	'IDX_account_identity_provider_subject',
	['provider', 'provider_user_id'],
	{ unique: true },
)
// One identity per provider per user; a second Google account cannot shadow the first.
@Index('IDX_account_identity_user_provider', ['user_id', 'provider'], {
	unique: true,
})
export default class AccountIdentityEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column('uuid', { nullable: false })
	user_id!: EntityId;

	@Column({
		type: 'enum',
		enum: AccountIdentityProviderEnum,
		nullable: false,
	})
	provider!: AccountIdentityProvider;

	@Column('varchar', {
		length: 191,
		nullable: false,
		comment: 'Subject id as reported by the provider (`sub` / Graph `id`)',
	})
	provider_user_id!: string;

	@Column('varchar', {
		nullable: true,
		comment:
			'Email reported by the provider at link time; kept for auditing only',
	})
	email!: string | null;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@Column({ type: 'timestamp', nullable: true })
	last_login_at!: Date | null;

	// RELATIONS
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity;
}
