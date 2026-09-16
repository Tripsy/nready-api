import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type AddressEntity from '@/features/address/address.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';

export const WarehouseStatusEnum = {
	ACTIVE: 'active',
	INACTIVE: 'inactive',
} as const;

export type WarehouseStatus =
	(typeof WarehouseStatusEnum)[keyof typeof WarehouseStatusEnum];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<WarehouseStatus> = {
	[WarehouseStatusEnum.ACTIVE]: [WarehouseStatusEnum.INACTIVE],
	[WarehouseStatusEnum.INACTIVE]: [WarehouseStatusEnum.ACTIVE],
};

const ENTITY_TABLE_NAME = 'warehouse';

/**
 * Warehouse exists to give quantities somewhere to belong, or as a label for where products are
 * shipped from - even for products marked with `track_stock = false`.
 *
 * That second job is why `shipping.warehouse_id` is `NOT NULL` while stock tracking is
 * optional: a kitchen sending out food owns no inventory, but the order still left from somewhere.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Locations stock is held in, and the origin goods are shipped from - including for products that are not stock-tracked',
})
// At most one default. Partial rather than a check constraint, because the rule is about the set
// of rows rather than any single one
@Index('IDX_warehouse_default', ['is_default'], {
	unique: true,
	where: 'is_default = true AND deleted_at IS NULL',
})
export default class WarehouseEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('int', { nullable: false })
	@Index('IDX_warehouse_address_id')
	address_id!: number;

	@Column('varchar', {
		length: 16,
		nullable: false,
		comment: 'Short internal identifier, e.g. BUC-01',
	})
	@Index('IDX_warehouse_code', { unique: true, where: 'deleted_at IS NULL' })
	code!: string;

	@Column('varchar', { nullable: false })
	@Index('IDX_warehouse_name')
	name!: string;

	@Column({
		type: 'enum',
		enum: WarehouseStatusEnum,
		default: WarehouseStatusEnum.ACTIVE,
		nullable: false,
	})
	@Index('IDX_warehouse_status')
	status!: WarehouseStatus;

	// The warehouse used when nothing else is chosen, so a single-site business never picks one
	@Column('boolean', {
		nullable: false,
		default: false,
	})
	is_default!: boolean;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('AddressEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'address_id' })
	address!: AddressEntity;
}
