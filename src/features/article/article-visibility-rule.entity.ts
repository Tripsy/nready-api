import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import type ArticleEntity from '@/features/article/article.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

const ENTITY_TABLE_NAME = 'article_visibility_rule';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment: 'Visibility rules for articles with restricted visibility',
})
// No partial unique index on article_id here: the OneToOne owner already emits a plain UNIQUE
// constraint, which is not scoped to `deleted_at IS NULL`. A soft-deleted rule therefore keeps
// its slot - the service restores and updates the existing row instead of inserting a second one
export default class ArticleVisibilityRuleEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column('uuid', { nullable: false })
	article_id!: EntityId;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'Only logged-in users can view the article',
	})
	requires_auth!: boolean;

	@Column('boolean', {
		nullable: false,
		default: false,
		comment: 'An active subscription is required to view the article',
	})
	requires_subscription!: boolean;

	@Column('varchar', {
		length: 2,
		array: true,
		nullable: true,
		comment:
			'ISO 3166-1 alpha-2 codes allowed to view; null means no country restriction',
	})
	allowed_countries!: string[] | null;

	// Stored as a bcrypt hash - a shared access password is still a credential
	@Column('varchar', {
		nullable: true,
		comment: 'Hashed password required to view the article',
	})
	password!: string | null;

	@Column('boolean', {
		nullable: false,
		default: true,
		comment: 'Whether the article is listed in indexes, feeds and search',
	})
	is_listed!: boolean;

	// RELATIONS
	@OneToOne(
		'ArticleEntity',
		(article: ArticleEntity) => article.visibility_rule,
		{ onDelete: 'CASCADE' },
	)
	@JoinColumn({ name: 'article_id' })
	article!: ArticleEntity;
}
