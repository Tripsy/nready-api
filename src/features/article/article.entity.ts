import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	OneToOne,
} from 'typeorm';
import type ArticleCategoryEntity from '@/features/article/article-category.entity';
import type ArticleContentEntity from '@/features/article/article-content.entity';
import type ArticleTagEntity from '@/features/article/article-tag.entity';
import type ArticleVisibilityRuleEntity from '@/features/article/article-visibility-rule.entity';
import type UserEntity from '@/features/user/user.entity';
import { EntityAbstract } from '@/shared/abstracts/entity.abstract';
import type { StatusTransitions } from '@/shared/types/common.type';
import type { EntityId } from '@/shared/types/entity-id.type';

export const ArticleStatusEnum = {
	DRAFT: 'draft',
	PENDING: 'pending', // Article pending review
	REJECTED: 'rejected', // Article rejected by review
	SCHEDULED: 'scheduled', // Article having `publish_at` set as a future date
	PUBLISHED: 'published', // Article displayed
	ARCHIVED: 'archived', // Not available for display
} as const;

export type ArticleStatus =
	(typeof ArticleStatusEnum)[keyof typeof ArticleStatusEnum];

// Allowed status transition configuration
export const STATUS_TRANSITIONS: StatusTransitions<ArticleStatus> = {
	[ArticleStatusEnum.DRAFT]: [ArticleStatusEnum.PENDING],
	[ArticleStatusEnum.PENDING]: [
		ArticleStatusEnum.REJECTED,
		ArticleStatusEnum.SCHEDULED,
		ArticleStatusEnum.PUBLISHED,
	],
	[ArticleStatusEnum.REJECTED]: [ArticleStatusEnum.DRAFT],
	[ArticleStatusEnum.SCHEDULED]: [
		ArticleStatusEnum.DRAFT,
		ArticleStatusEnum.PUBLISHED,
	],
	[ArticleStatusEnum.PUBLISHED]: [ArticleStatusEnum.ARCHIVED],
	[ArticleStatusEnum.ARCHIVED]: [
		// Allow nothing
	],
};

export const ArticleLayoutEnum = {
	DEFAULT: 'default',
} as const;

export type ArticleLayout =
	(typeof ArticleLayoutEnum)[keyof typeof ArticleLayoutEnum];

export const ArticleFeaturedStatusEnum = {
	SECTION: 'section',
	CATEGORY: 'category',
} as const;

export type ArticleFeaturedStatus =
	(typeof ArticleFeaturedStatusEnum)[keyof typeof ArticleFeaturedStatusEnum];

export const ArticleVisibilityEnum = {
	PUBLIC: 'public', // No restrictions - everyone can view
	RESTRICTED: 'restricted', // Configuration options available via separate entity (article_visibility_rules)
} as const;

export type ArticleVisibility =
	(typeof ArticleVisibilityEnum)[keyof typeof ArticleVisibilityEnum];

export const ArticleSourceModeEnum = {
	INPUT: 'input', // Written in-house
	PARSED: 'parsed', // Imported from an external source
} as const;

export type ArticleSourceMode =
	(typeof ArticleSourceModeEnum)[keyof typeof ArticleSourceModeEnum];

export type ArticleSource = {
	label?: string; // Display name of the source
	url?: string; // Link back to the original
	disclaimer?: string; // Legal / editorial notice
	about?: string; // Short description of the source
};

/**
 * The reader-contributed features an article opts into: ratings, comments and complaints. They
 * are per-article switches kept in `details` rather than columns of their own - three booleans
 * nothing filters or sorts by, on a table whose jsonb column exists for exactly this.
 *
 * A key absent from `details` means "whatever the deployment defaults to", which is what
 * `resolveArticleSettings` reads from the environment. Only an explicit override is stored, so an
 * article filed before a default was flipped follows the new default instead of freezing the old
 * one.
 */
export const ArticleSettingEnum = {
	ALLOW_RATING: 'allow_rating',
	ALLOW_COMMENTS: 'allow_comments',
	ALLOW_COMPLAINTS: 'allow_complaints',
} as const;

export type ArticleSetting =
	(typeof ArticleSettingEnum)[keyof typeof ArticleSettingEnum];

export type ArticleSettings = Record<ArticleSetting, boolean>;

export type ArticleDetails = Record<string, string | number | boolean>;

/**
 * `article` is an additional feature, so its switches live with the code that governs them rather
 * than in `settings.config.ts`, which every project started from this boilerplate carries - the
 * same reasoning as `isCommentAutoApproved()` in `comment.service.ts`.
 */
const SETTING_ENVIRONMENT_VARIABLE: Record<ArticleSetting, string> = {
	[ArticleSettingEnum.ALLOW_RATING]: 'ARTICLE_ALLOW_RATING',
	[ArticleSettingEnum.ALLOW_COMMENTS]: 'ARTICLE_ALLOW_COMMENTS',
	[ArticleSettingEnum.ALLOW_COMPLAINTS]: 'ARTICLE_ALLOW_COMPLAINTS',
};

/**
 * All three default to on: an article nobody can react to is the exception, not the norm, so the
 * variable is only ever set to close something down. Read at call time rather than frozen into a
 * module-level const, so a test can set the variable and get the other branch without reloading
 * the module.
 */
export const isArticleSettingEnabledByDefault = (
	setting: ArticleSetting,
): boolean => process.env[SETTING_ENVIRONMENT_VARIABLE[setting]] !== 'false';

/**
 * The effective switches for one article - the stored override where there is one, the
 * deployment default everywhere else. A non-boolean under a known key is treated as absent:
 * `details` is free-form jsonb and nothing but this guards what lands in it.
 */
export const resolveArticleSettings = (
	details: ArticleDetails | null | undefined,
): ArticleSettings => {
	const settings = {} as ArticleSettings;

	for (const setting of Object.values(ArticleSettingEnum)) {
		const stored = details?.[setting];

		settings[setting] =
			typeof stored === 'boolean'
				? stored
				: isArticleSettingEnabledByDefault(setting);
	}

	return settings;
};

/**
 * Merge overrides into `details` without disturbing the keys this does not own. An override set
 * back to the deployment default is dropped rather than stored, so the article keeps following
 * the default when it changes; `details` collapses to `null` once nothing is left in it.
 */
export const applyArticleSettings = (
	details: ArticleDetails | null | undefined,
	overrides: Partial<ArticleSettings>,
): ArticleDetails | null => {
	const merged: ArticleDetails = { ...details };

	for (const setting of Object.values(ArticleSettingEnum)) {
		const override = overrides[setting];

		if (override === undefined) {
			continue;
		}

		if (override === isArticleSettingEnabledByDefault(setting)) {
			delete merged[setting];

			continue;
		}

		merged[setting] = override;
	}

	return Object.keys(merged).length > 0 ? merged : null;
};

const ENTITY_TABLE_NAME = 'article';

@Entity({
	name: ENTITY_TABLE_NAME,
	schema: 'public',
	comment:
		'Stores core article information; textual content is saved in article-content.entity',
})
// The public listing is "published, already released, newest first", and the scheduler asks the
// same shape ("scheduled with publish_at due"). Leftmost on status, so a status-only filter is
// covered too
@Index('IDX_article_status_publish_at', ['status', 'publish_at'])
// Featured slots are a small subset, and they are always read as an ordered group
@Index('IDX_article_featured', ['featured_status', 'featured_order'], {
	where: 'featured_status IS NOT NULL AND deleted_at IS NULL',
})
// Both scheduled transitions are cron scans over a handful of due rows; the partial predicate keeps
// the index to the rows that actually carry a deadline
@Index('IDX_article_archive_at', ['archive_at'], {
	where: 'archive_at IS NOT NULL AND deleted_at IS NULL',
})
@Index('IDX_article_public_at', ['public_at'], {
	where: 'public_at IS NOT NULL AND deleted_at IS NULL',
})
export default class ArticleEntity extends EntityAbstract {
	static readonly NAME: string = ENTITY_TABLE_NAME;
	static readonly HAS_CACHE: boolean = true;

	@Column({
		type: 'enum',
		enum: ArticleStatusEnum,
		default: ArticleStatusEnum.DRAFT,
		nullable: false,
	})
	status!: ArticleStatus;

	@Column({
		type: 'enum',
		enum: ArticleLayoutEnum,
		default: ArticleLayoutEnum.DEFAULT,
		nullable: false,
	})
	layout!: ArticleLayout;

	@Column('jsonb', {
		nullable: true,
		comment:
			'Free-form article data; the `allow_rating` / `allow_comments` / `allow_complaints` keys hold the per-article overrides of the deployment defaults',
	})
	details!: ArticleDetails | null;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'Controls when the article should be displayed',
	})
	publish_at?: Date | null;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment: 'Controls when the article should transition to archived',
	})
	archive_at?: Date | null;

	@Column({
		type: 'enum',
		enum: ArticleFeaturedStatusEnum,
		nullable: true,
	})
	featured_status!: ArticleFeaturedStatus | null;

	@Column('int', {
		nullable: false,
		default: 0,
		comment:
			'Order/position of the article within the featured group; Relevant only when featured_status is set',
	})
	featured_order!: number;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment:
			'Controls when featured_status should be cleared; Relevant only when featured_status is set',
	})
	featured_expire_at?: Date | null;

	@Column({
		type: 'enum',
		enum: ArticleVisibilityEnum,
		default: ArticleVisibilityEnum.PUBLIC,
		nullable: false,
	})
	visibility!: ArticleVisibility;

	@Column({
		type: 'timestamp',
		nullable: true,
		comment:
			'Controls when the article with restricted visibility should transition to public',
	})
	public_at?: Date | null;

	// Provenance, not presentation - it decides whether the parser owns the record, so it stays a
	// real column the queries can filter on and is never accepted from an update payload
	@Column({
		type: 'enum',
		enum: ArticleSourceModeEnum,
		default: ArticleSourceModeEnum.INPUT,
		nullable: false,
	})
	source_mode!: ArticleSourceMode;

	@Column('jsonb', {
		nullable: true,
		comment:
			'Source attribution for display (label, url, disclaimer, about)',
	})
	source!: ArticleSource | null;

	// RELATIONS
	@Column('uuid', { nullable: true })
	@Index('IDX_article_author_id')
	author_id!: EntityId | null;

	// The author is attribution, not ownership - deleting the user must leave the article standing
	@ManyToOne('UserEntity', {
		onDelete: 'SET NULL',
		nullable: true,
	})
	@JoinColumn({ name: 'author_id' })
	author?: UserEntity | null;

	@OneToMany(
		'ArticleContentEntity',
		(content: ArticleContentEntity) => content.article,
	)
	contents?: ArticleContentEntity[];

	// Only present while `visibility` is `restricted`
	@OneToOne(
		'ArticleVisibilityRuleEntity',
		(rule: ArticleVisibilityRuleEntity) => rule.article,
	)
	visibility_rule?: ArticleVisibilityRuleEntity | null;

	@OneToMany('ArticleTagEntity', (tag: ArticleTagEntity) => tag.article)
	tags!: ArticleTagEntity[];

	@OneToMany(
		'ArticleCategoryEntity',
		(category: ArticleCategoryEntity) => category.article,
	)
	categories?: ArticleCategoryEntity[];
}
