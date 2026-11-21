import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	UpdateDateColumn,
} from 'typeorm';
import type ArticleEntity from '@/features/article/article.entity';
import type { PageMeta } from '@/shared/abstracts/entity.abstract';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export type ArticleAuthorType = {
	name: string;
	email?: string;
	avatar?: string;
	description?: string;
};

const ENTITY_TABLE_NAME = 'article_content';

/**
 * Named because the service maps this index's violation back to the 409 its slug
 * pre-check raises - Postgres reports the constraint by name and nothing else
 * distinguishes it from the `(article_id, language)` one.
 */
export const SLUG_UNIQUE_INDEX = 'IDX_article_content_slug_lang';

/**
 * Deliberately not `EntityAbstract`: this table has no `deleted_at`.
 * A translation is never deleted on its own - the only write is `saveContent`'s upsert - and
 * the row dies with its article through the FK cascade.
 */
@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Language-specific content for articles (title, slug, brief, content, meta)',
})
@Index('IDX_article_content_unique_per_lang', ['article_id', 'language'], {
	unique: true,
})
@Index(SLUG_UNIQUE_INDEX, ['slug', 'language'], {
	unique: true,
})
export default class ArticleContentEntity extends EntityIdAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;

	@UpdateDateColumn({ type: 'timestamp', nullable: true })
	updated_at!: Date | null;

	@Column('uuid', { nullable: false })
	article_id!: EntityId;

	@Column('varchar', {
		length: 3,
		default: 'en',
	})
	language!: string;

	@Column('varchar', { nullable: false })
	slug!: string;

	@Column('jsonb', {
		nullable: true,
		comment: 'Author details',
	})
	author!: ArticleAuthorType | null;

	@Column('text', { nullable: false })
	title!: string;

	@Column('text', { nullable: true })
	brief!: string | null;

	@Column('text', { nullable: false })
	content!: string;

	@Column('jsonb', {
		nullable: true,
		comment: 'SEO metadata, canonical URL, images, structured data, etc.',
	})
	meta!: PageMeta | null;

	// RELATIONS
	@ManyToOne('ArticleEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'article_id' })
	article!: ArticleEntity;
}
