import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ArticleEntity from '@/features/article/article.entity';
import type TermEntity from '@/features/term/term.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'article_tag';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Links articles to tag terms',
})
@Index('IDX_article_tag_unique', ['article_id', 'tag_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class ArticleTagEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column('uuid', { nullable: false })
	article_id!: EntityId;

	@Column('uuid', { nullable: false })
	@Index('IDX_article_tag_tag_id')
	tag_id!: EntityId;

	@Column('jsonb', {
		nullable: true,
		comment: 'Reserved column for future use',
	})
	details!: Record<string, string | number | boolean> | null;

	// RELATIONS
	@ManyToOne('ArticleEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'article_id' })
	article!: ArticleEntity;

	@ManyToOne('TermEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'tag_id' })
	tag!: TermEntity;
}
