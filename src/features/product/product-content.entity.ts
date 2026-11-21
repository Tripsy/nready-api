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
import type ProductEntity from './product.entity';

const ENTITY_TABLE_NAME = 'product_content';

/**
 * Named because the service maps this index's violation back to the 409 its slug pre-check
 * raises - Postgres reports the constraint by name and nothing else distinguishes it from the
 * `(product_id, language)` one.
 */
export const SLUG_UNIQUE_INDEX = 'IDX_product_content_slug_lang';

/**
 * Deliberately not `EntityAbstract`: this table has no `deleted_at`.
 * A translation is never deleted on its own - the only write is `saveContent`'s upsert - and
 * the row dies with its product through the FK cascade.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Language-specific content for products (name, slug, descriptions, meta)',
})
@Index('IDX_product_content_unique_per_lang', ['product_id', 'language'], {
	unique: true,
})
@Index(SLUG_UNIQUE_INDEX, ['slug', 'language'], {
	unique: true,
})
export default class ProductContentEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column('uuid', { nullable: false })
	product_id!: EntityId;

	@Column('varchar', {
		length: 3,
		default: 'en',
	})
	language!: string;

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

	// RELATIONS
	@ManyToOne('ProductEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'product_id' })
	product!: ProductEntity;
}
