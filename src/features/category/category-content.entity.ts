import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	UpdateDateColumn,
} from 'typeorm';
import type { PageMeta } from '@/shared/abstracts/entity.abstract';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type CategoryEntity from './category.entity';
import { type CategoryType, CategoryTypeEnum } from './category.entity';

const ENTITY_TABLE_NAME = 'category_content';

/**
 * Deliberately not `EntityAbstract`: this table has no `deleted_at`.
 * A translation is never deleted on its own - the only write is `saveContent`'s upsert - and
 * the row dies with its category through the FK cascade.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Language-specific category content (slug, description, metadata)',
})
@Index(
	'IDX_category_content_category_id_language',
	['category_id', 'language'],
	{ unique: true },
)
@Index('IDX_category_content_slug_language', ['type', 'slug', 'language'], {
	unique: true,
})
export default class CategoryContentEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column('uuid', { nullable: false })
	category_id!: EntityId;

	@Column('varchar', {
		length: 3,
		default: 'en',
	})
	language!: string;

	@Column({
		type: 'enum',
		enum: CategoryTypeEnum,
		nullable: false,
		select: false,
		comment:
			'The type is duplicated here from category to be used as unique index',
	})
	type!: CategoryType;

	@Column('varchar', { nullable: false })
	label!: string;

	@Column('varchar', { nullable: false })
	slug!: string;

	@Column('text', { nullable: true })
	description!: string | null;

	@Column('jsonb', {
		nullable: true,
		comment: 'SEO metadata, canonical URL, images, structured data, etc.',
	})
	meta!: PageMeta | null;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// RELATIONS
	@ManyToOne('CategoryEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'category_id' })
	category!: CategoryEntity;
}
