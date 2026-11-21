import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
} from 'typeorm';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import type SubscriptionEntity from '@/features/subscription/subscription.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export const SubscriptionEvidenceStatusEnum = {
	SUCCESS: 'success',
	FAILED: 'failed',
} as const;

export type SubscriptionEvidenceStatus =
	(typeof SubscriptionEvidenceStatusEnum)[keyof typeof SubscriptionEvidenceStatusEnum];

const ENTITY_TABLE_NAME = 'subscription_evidence';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Used to track renewal attempts for subscriptions.',
})
export default class SubscriptionEvidenceEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	@Index('IDX_subscription_evidence_subscription_id')
	subscription_id!: EntityId;

	@Column('uuid', { nullable: false })
	@Index('IDX_subscription_evidence_invoice_id')
	invoice_id!: EntityId;

	@Column({
		type: 'enum',
		enum: SubscriptionEvidenceStatusEnum,
		nullable: false,
	})
	@Index('IDX_subscription_evidence_status')
	status!: SubscriptionEvidenceStatus;

	@Column('jsonb', {
		nullable: true,
		comment:
			'Response data from the payment gateway. For example: { "transaction_id": "1234567890" }',
	})
	response_data!: Record<string, unknown> | null;

	@Column('text', { nullable: true })
	fail_reason!: string | null;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	recorded_at!: Date;

	// RELATIONS
	@ManyToOne('SubscriptionEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'subscription_id' })
	subscription!: SubscriptionEntity;

	// RESTRICT: the evidence row is the audit trail for a renewal, so the invoice it charged
	// against has to stay reachable for as long as the evidence does
	@ManyToOne('InvoiceEntity', {
		onDelete: 'RESTRICT',
	})
	@JoinColumn({ name: 'invoice_id' })
	invoice!: InvoiceEntity;
}
