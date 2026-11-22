import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { RequestContextSource } from '@/config/request.context';
import type UserEntity from '@/features/user/user.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { LogHistoryAction } from '@/shared/types/log-history.type';

const ENTITY_TABLE_NAME = 'log_history';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'logs',
	comment: 'Store entities history: created, updated, deleted, etc.',
})
/*
 * `entity` leads because an id is only meaningful within its entity - id 5 exists for
 * `user`, `product` and `order` alike. This order also serves a filter on `entity` alone,
 * which an `entity_id`-leading index cannot.
 */
@Index('IDX_log_history_entity_id_action', ['entity', 'entity_id', 'action'], {
	unique: false,
})
export default class LogHistoryEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('varchar', { nullable: false })
	entity!: string;

	@Column({ type: 'uuid', nullable: false })
	entity_id!: EntityId;

	@Column({ type: 'varchar', nullable: false })
	action!: LogHistoryAction;

	@Column({ type: 'uuid', nullable: true })
	@Index('IDX_log_history_auth_id', { unique: false })
	auth_id!: EntityId | null;

	@Column({ type: 'varchar', nullable: false })
	@Index('IDX_log_history_performed_by', { unique: false })
	performed_by!: string;

	@Column({ type: 'varchar', nullable: false })
	@Index('IDX_log_history_request_id', { unique: false })
	request_id!: string;

	@Column({ type: 'varchar', nullable: false })
	@Index('IDX_log_history_source', { unique: false })
	source!: RequestContextSource;

	@Column({ type: 'timestamp', nullable: false })
	@Index('IDX_log_history_recorded_at', { unique: false })
	recorded_at!: Date;

	@Column({ type: 'jsonb', nullable: true, comment: 'Log data' })
	details?: Record<string, unknown>;

	// RELATIONS
	@ManyToOne('UserEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'auth_id', referencedColumnName: 'id' })
	user?: UserEntity | null;
}
