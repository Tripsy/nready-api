import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import type AddressEntity from '@/features/address/address.entity';
import type ClientEntity from '@/features/client/client.entity';

export const ClientAddressTypeEnum = {
	BILLING: 'billing',
	DELIVERY: 'delivery',
} as const;

export type ClientAddressType =
	(typeof ClientAddressTypeEnum)[keyof typeof ClientAddressTypeEnum];

const ENTITY_TABLE_NAME = 'client_address';

/**
 * Files an existing `address` against a client as either where it is billed or where goods go.
 *
 * The street data lives in `address` and may be shared: two clients in the same building, or one
 * client billed and delivered at the same place, point at the same row. What is specific to this
 * client is kept here - `details` for the flat, floor or apartment number, `notes` for instructions
 * about reaching it. The address is therefore never edited or removed through a client address.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Billing and delivery addresses held by a client',
})
// Every address a client holds, narrowed by type. Leading on `client_id` also serves the cascade
// a client's hard delete triggers
@Index('IDX_client_address_client_id', ['client_id', 'type'])
// Not `EntityAbstract`: this table carries no `deleted_at`. There is no restore, so a soft-deleted
// row would be unreachable - a removed client address is deleted outright. Orders keep their own
// copy of the address they were placed with, so nothing reads a removed row afterward
export default class ClientAddressEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	// No index of its own: leftmost column of `IDX_client_address_client_id`
	@Column('int', { nullable: false })
	client_id!: number;

	// Indexed for the `RESTRICT` check a delete of the address runs against this table
	@Column('int', { nullable: false })
	@Index('IDX_client_address_address_id')
	address_id!: number;

	@Column({
		type: 'enum',
		enum: ClientAddressTypeEnum,
		nullable: false,
	})
	type!: ClientAddressType;

	@Column('text', {
		nullable: true,
		comment: 'Flat, floor or apartment number within the address',
	})
	details!: string | null;

	// OTHER
	@Column('text', {
		nullable: true,
		comment: 'Instructions about reaching the address',
	})
	notes!: string | null;

	// RELATIONS
	// CASCADE: the row has no meaning without its client. A client is soft-deleted, which fires
	// nothing - this only acts on a hard delete
	@ManyToOne('ClientEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'client_id' })
	client?: ClientEntity;

	// RESTRICT, as `warehouse.address_id`: an address still filed against a client cannot be removed
	@ManyToOne('AddressEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'address_id' })
	address?: AddressEntity;
}
