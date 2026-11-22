import {
	Column,
	CreateDateColumn,
	DeleteDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
} from 'typeorm';
import type PermissionEntity from '@/features/permission/permission.entity';
import type UserEntity from '@/features/user/user.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'user_permission';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores user permissions',
})
@Index('IDX_user_permission_permission', ['user_id', 'permission_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class UserPermissionEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	user_id!: EntityId;

	@Column('uuid', { nullable: false })
	@Index('IDX_user_permission_permission_id')
	permission_id!: EntityId;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@DeleteDateColumn({ type: 'timestamp', nullable: true, select: true })
	deleted_at!: Date | null;

	// RELATIONS
	@ManyToOne('UserEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity;

	@ManyToOne('PermissionEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'permission_id' })
	permission?: PermissionEntity;
}
