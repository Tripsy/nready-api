import { Column, DeleteDateColumn, Entity, Index } from 'typeorm';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';

const ENTITY_TABLE_NAME = 'permission';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'system',
	comment: 'Stores permissions',
})
@Index('IDX_permission', ['entity', 'operation'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class PermissionEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('varchar', { nullable: false })
	entity!: string;

	@Column('varchar', { nullable: false })
	operation!: string;

	@DeleteDateColumn({ type: 'timestamp', nullable: true, select: true })
	deleted_at!: Date | null;
}
