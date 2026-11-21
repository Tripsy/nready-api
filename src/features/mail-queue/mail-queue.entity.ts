import type Mail from 'nodemailer/lib/mailer';
import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	UpdateDateColumn,
} from 'typeorm';
import type TemplateEntity from '@/features/template/template.entity';
import type { EmailContent } from '@/features/template/template.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export const MailQueueStatusEnum = {
	PENDING: 'pending',
	SENT: 'sent',
	ERROR: 'error',
} as const;

export type MailQueueStatus =
	(typeof MailQueueStatusEnum)[keyof typeof MailQueueStatusEnum];

const ENTITY_TABLE_NAME = 'mail_queue';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'system',
})
export default class MailQueueEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({ type: 'uuid', nullable: true })
	@Index('IDX_mail_queue_template_id')
	template_id?: EntityId | null;

	@Column('varchar', { length: 3, nullable: false })
	language!: string;

	@Column({
		type: 'jsonb',
		nullable: false,
		comment: 'Email content: subject, text, html, vars, layout',
	})
	content!: EmailContent;

	@Column({ type: 'jsonb', nullable: false, comment: 'To: name & address' })
	to!: Mail.Address;

	@Column({ type: 'jsonb', nullable: true, comment: 'From: name & address' })
	from?: Mail.Address;

	@Column({
		type: 'enum',
		enum: MailQueueStatusEnum,
		default: MailQueueStatusEnum.PENDING,
		nullable: false,
	})
	@Index('IDX_mail_queue_status', { unique: false })
	status!: MailQueueStatus;

	@Column('text', { nullable: true })
	error?: string | null;

	@Column({ type: 'timestamp', nullable: true })
	@Index('IDX_mail_queue_sent_at', { unique: false })
	sent_at!: Date | null;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	// RELATIONS
	@ManyToOne('TemplateEntity', {
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'template_id', referencedColumnName: 'id' })
	template?: TemplateEntity | null;
}
