import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	UpdateDateColumn,
} from 'typeorm';
import type PlaceEntity from '@/features/place/place.entity';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export type PlaceContentType = {
	language: string;
	name: string;
	type_label: string;
};

const ENTITY_TABLE_NAME = 'place_content';

/**
 * Deliberately not `EntityAbstract`: this table has no `deleted_at`.
 * A translation is never deleted on its own - the only write is `saveContent`'s upsert - and
 * the row dies with its place through the FK cascade.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Language-specific content for places',
})
@Index('IDX_place_content_unique_per_lang', ['place_id', 'language'], {
	unique: true,
})
export default class PlaceContentEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column('uuid', { nullable: false })
	place_id!: EntityId;

	@Column('varchar', {
		length: 3,
		default: 'en',
	})
	language!: string;

	@Column('varchar', { nullable: false })
	name!: string;

	@Column('varchar', {
		nullable: false,
		comment: 'ex: Country, Region, City, Oras, Judet',
	})
	type_label!: string;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// RELATIONS
	@ManyToOne('PlaceEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'place_id' })
	place!: PlaceEntity;
}
