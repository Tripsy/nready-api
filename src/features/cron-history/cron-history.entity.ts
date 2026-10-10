import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const CronHistoryStatusEnum = {
	ERROR: 'error',
	OK: 'ok',
	WARNING: 'warning', // Set when cron job is not running in expected time
	// Written when the job starts; a row left in it past its lease means the job hung or its
	// process died mid-run - `cron-stuck-check` reports those
	RUNNING: 'running',
} as const;

export type CronHistoryStatus =
	(typeof CronHistoryStatusEnum)[keyof typeof CronHistoryStatusEnum];

const ENTITY_TABLE_NAME = 'cron_history';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'logs',
	comment: 'Stores cron usage',
})
export default class CronHistoryEntity {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@PrimaryGeneratedColumn({ type: 'int' })
	id!: number;

	@Column('varchar', { nullable: false })
	label!: string;

	@Column({ type: 'timestamp', nullable: false })
	@Index('IDX_cron_history_start_at', { unique: false })
	start_at!: Date;

	// NULL while the run is in progress
	@Column({ type: 'timestamp', nullable: true })
	end_at!: Date | null;

	@Column({
		type: 'enum',
		enum: CronHistoryStatusEnum,
		nullable: false,
	})
	@Index('IDX_cron_history_status', { unique: false })
	status!: CronHistoryStatus;

	@Column('smallint', {
		nullable: false,
		default: 0,
		comment: 'Run time in seconds',
	})
	run_time!: number;

	@Column({ type: 'jsonb', nullable: true, comment: 'Cron data' })
	content?: Record<string, unknown>;
}
