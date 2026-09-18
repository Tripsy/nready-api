import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type UserEntity from '@/features/user/user.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';

export const ClientStatusEnum = {
	ACTIVE: 'active',
	INACTIVE: 'inactive',
	PENDING: 'pending',
} as const;

export type ClientStatus =
	(typeof ClientStatusEnum)[keyof typeof ClientStatusEnum];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<ClientStatus> = {
	[ClientStatusEnum.ACTIVE]: [ClientStatusEnum.INACTIVE],
	[ClientStatusEnum.INACTIVE]: [ClientStatusEnum.ACTIVE],
	[ClientStatusEnum.PENDING]: [
		ClientStatusEnum.ACTIVE,
		ClientStatusEnum.INACTIVE,
	],
};

export const ClientTypeEnum = {
	PERSON: 'person',
	COMPANY: 'company',
} as const;

export type ClientType = (typeof ClientTypeEnum)[keyof typeof ClientTypeEnum];

export type ClientIdentityData =
	| {
			client_type: typeof ClientTypeEnum.COMPANY;
			company_name?: string | null;
			company_cui?: string | null;
			company_reg_com?: string | null;
	  }
	| {
			client_type: typeof ClientTypeEnum.PERSON;
			person_identification_number?: string | null;
	  };

const ENTITY_TABLE_NAME = 'client';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Stores client information for persons OR companies',
})
@Index('IDX_client_company_name_unique', ['company_name'], {
	unique: true,
	where: "company_name IS NOT NULL AND client_type = 'company' AND deleted_at IS NULL",
})
@Index('IDX_client_cui_unique', ['company_cui'], {
	unique: true,
	where: "company_cui IS NOT NULL AND client_type = 'company' AND deleted_at IS NULL",
})
@Index('IDX_client_reg_com_unique', ['company_reg_com'], {
	unique: true,
	where: "company_reg_com IS NOT NULL AND client_type = 'company' AND deleted_at IS NULL",
})
@Index('IDX_client_cnp_unique', ['person_identification_number'], {
	unique: true,
	where: "person_identification_number IS NOT NULL AND client_type = 'person' AND deleted_at IS NULL",
})
export default class ClientEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({
		type: 'enum',
		enum: ClientTypeEnum,
		nullable: false,
	})
	client_type!: ClientType;

	@Column({
		type: 'enum',
		enum: ClientStatusEnum,
		default: ClientStatusEnum.PENDING,
		nullable: false,
	})
	status!: ClientStatus;

	// COMPANY FIELDS
	@Column('varchar', { nullable: true })
	company_name!: string | null;

	@Column('varchar', { nullable: true })
	company_cui!: string | null;

	@Column('varchar', { nullable: true })
	company_reg_com!: string | null;

	// PERSON FIELDS
	@Column('varchar', { nullable: true })
	person_name!: string | null;

	@Column('varchar', { nullable: true, select: false })
	person_identification_number!: string | null;

	// FINANCIAL FIELDS
	@Column('varchar', { nullable: true })
	iban!: string | null;

	@Column('varchar', { nullable: true })
	bank_name!: string | null;

	// CONTACT
	@Column('varchar', { nullable: true })
	contact_name!: string | null;

	@Column('varchar', { nullable: true })
	contact_email!: string | null;

	@Column('varchar', { nullable: true })
	contact_phone!: string | null;

	/**
	 * The account this client belongs to. One account may hold several clients - a person billing
	 * privately and through their company - and a client is held by at most one account.
	 *
	 * Null on a client typed in from the back office that no account has claimed. Checkout only
	 * accepts a client the caller holds, and a review counts as a verified purchase only through
	 * an order placed on one of its author's clients.
	 */
	@Column('int', { nullable: true })
	@Index('IDX_client_user_id', { where: 'user_id IS NOT NULL' })
	user_id!: number | null;

	// OTHER
	@Column('text', { nullable: true })
	notes!: string | null;

	// RELATIONS
	@ManyToOne('UserEntity', {
		onDelete: 'SET NULL',
		nullable: true,
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity | null;
}
