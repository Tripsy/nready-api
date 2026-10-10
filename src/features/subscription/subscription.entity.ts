import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type OrderEntity from '@/features/order/order.entity';
import type UserEntity from '@/features/user/user.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';

export const SubscriptionStatusEnum = {
	ACTIVE: 'active',
	PAUSED: 'paused',
	CANCELED: 'canceled',
	EXPIRED: 'expired',
} as const;

export type SubscriptionStatus =
	(typeof SubscriptionStatusEnum)[keyof typeof SubscriptionStatusEnum];

const ENTITY_TABLE_NAME = 'subscription';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Recurring subscriptions created from orders',
})
@Index('IDX_subscription_end_at', ['end_at', 'status'])
export default class SubscriptionEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Index('IDX_subscription_order_id', {
		unique: true,
		where: 'deleted_at IS NULL',
	})
	@Column('int', { nullable: false })
	order_id!: number;

	@Column('int', {
		nullable: true,
		comment: 'When subscription is assigned to a user (virtual services)',
	})
	@Index('IDX_subscription_user_id')
	user_id!: number | null;

	@Column('varchar', {
		nullable: false,
		comment: 'Subscription reference code (e.g., S12345)',
	})
	@Index('IDX_subscription_ref_code', {
		unique: true,
		where: 'deleted_at IS NULL',
	})
	ref_code!: string;

	@Column({
		type: 'enum',
		enum: SubscriptionStatusEnum,
		default: SubscriptionStatusEnum.ACTIVE,
		nullable: false,
	})
	@Index('IDX_subscription_status')
	status!: SubscriptionStatus;

	@Column('timestamp', {
		nullable: true,
		comment: 'When the subscription started',
	})
	start_at!: Date | null;

	@Column('timestamp', {
		nullable: true,
		comment: 'When the subscription ended (if canceled/expired)',
	})
	end_at!: Date | null;

	@Column('smallint', {
		nullable: false,
		comment:
			'Number of days offered past end at as a grace period to allow renewals',
		default: 0,
	})
	grace_period!: number;

	@Column('boolean', {
		nullable: false,
		default: true,
		comment: 'Whether the subscription renews automatically',
	})
	auto_renew!: boolean;

	@Column('smallint', {
		nullable: false,
		comment:
			'Max count of renewals attempts before the subscription is marked as expired',
	})
	retry_count!: number;

	@Column('smallint', {
		nullable: false,
		comment: 'Number of days between each renewal attempt',
	})
	retry_interval!: number;

	@Column('timestamp', {
		nullable: true,
		comment: 'Next scheduled billing date',
	})
	next_billing_at!: Date | null;

	@Column('text', { nullable: true })
	notes!: string | null;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// RELATIONS
	@ManyToOne('OrderEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'order_id' })
	order!: OrderEntity;

	// The link is optional, so losing the user must not take the billing history with it
	@ManyToOne('UserEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'user_id' })
	user?: UserEntity | null;
}
