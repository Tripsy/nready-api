import {
	CreateDateColumn,
	DeleteDateColumn,
	Entity,
	UpdateDateColumn,
} from 'typeorm';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';

export const OrderDirectionEnum = {
	ASC: 'ASC',
	DESC: 'DESC',
} as const;

export type OrderDirection =
	(typeof OrderDirectionEnum)[keyof typeof OrderDirectionEnum];

export type PageMeta = {
	title?: string;
	description?: string;
	keywords?: string;
};

@Entity()
export abstract class EntityAbstract extends EntityIdAbstract {
	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@DeleteDateColumn({ type: 'timestamp', nullable: true, select: true })
	deleted_at!: Date | null;
}
