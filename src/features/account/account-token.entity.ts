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

const ENTITY_TABLE_NAME = 'account_token';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'system',
	comment: 'Stores `ident` for account tokens to manage token revocation',
})
export default class AccountTokenEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column('uuid', { nullable: false })
	@Index('IDX_account_token_user_id')
	user_id!: EntityId;

	@Column('char', { length: 36, nullable: false })
	@Index('IDX_account_token_ident', { unique: true })
	ident!: string;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@Column({ type: 'json', nullable: true, comment: 'Fingerprinting data' })
	metadata?: Record<string, unknown>;

	@Column({ type: 'timestamp', nullable: true })
	used_at!: Date | null;

	@Column({ type: 'timestamp', nullable: false })
	expire_at!: Date;

	// RELATIONS
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity;
}
