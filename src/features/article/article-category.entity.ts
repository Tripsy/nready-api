import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type ArticleEntity from '@/features/article/article.entity';
import type CategoryEntity from '@/features/category/category.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'article_category';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Link articles to categories',
})
@Index('IDX_article_category_unique', ['article_id', 'category_id'], {
	unique: true,
	where: 'deleted_at IS NULL',
})
export default class ArticleCategoryEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = false;

	@Column('uuid', { nullable: false })
	article_id!: EntityId;

	@Column('uuid', { nullable: false })
	@Index('IDX_article_category_category_id')
	category_id!: EntityId;

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

	@ManyToOne('CategoryEntity', {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'category_id' })
	category!: CategoryEntity;
}
