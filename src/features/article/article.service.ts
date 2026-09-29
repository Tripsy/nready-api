import {
	type DeepPartial,
	type EntityManager,
	QueryFailedError,
} from 'typeorm';
import dataSource from '@/config/data-source.config';
import { eventEmitter } from '@/config/event.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import ArticleEntity, {
	type ArticleDetails,
	type ArticleSettings,
	type ArticleStatus,
	ArticleVisibilityEnum,
	applyArticleSettings,
	resolveArticleSettings,
	STATUS_TRANSITIONS,
} from '@/features/article/article.entity';
import { getArticleRepository } from '@/features/article/article.repository';
import type {
	ArticleValidator,
	ArticleVisibilityRuleType,
} from '@/features/article/article.validator';
import type { ArticleAccessTarget } from '@/features/article/article-access.policy';
import ArticleCategoryRepository from '@/features/article/article-category.repository';
import {
	type ArticleAuthorType,
	SLUG_UNIQUE_INDEX,
} from '@/features/article/article-content.entity';
import ArticleContentRepository from '@/features/article/article-content.repository';
import ArticleTagRepository from '@/features/article/article-tag.repository';
import ArticleVisibilityRuleEntity from '@/features/article/article-visibility-rule.entity';
import CategoryEntity, {
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { encryptPassword } from '@/helpers/security.helper';
import { cacheProvider } from '@/providers/cache.provider';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import {
	resolveTargetImages,
	type TargetImage,
	TargetImageTypeEnum,
} from '@/shared/registries/target-image.registry';
import { LogHistoryActionEnum } from '@/shared/types/log-history.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * Columns owned by the article row itself - the rest live in child tables
 * (`article_content`, `article_category`, `article_tag`, `article_visibility_rule`).
 */
const entryColumns: string[] = [
	'layout',
	'publish_at',
	'archive_at',
	'featured_status',
	'featured_order',
	'visibility',
	'public_at',
	'source',
];

const slugConflictError = (): CustomError =>
	new CustomError(409, lang('article.error.slug_already_exists'));

/**
 * The one image a public surface shows for an article: the first of its gallery, by `sort_order`.
 *
 * "Cover" is this feature's word for the role, not a kind of image - the image feature knows only
 * `logo` and `gallery`, and nothing marks a row as the cover. It is whichever gallery image comes
 * first, which is why the type is an alias rather than a shape of its own: the payload is the
 * registry's, the name for it is article's, and `cover_image` is what the frontend reads.
 */
export type ArticleCoverImageType = TargetImage;

export type WithCoverImage<T> = T & {
	cover_image: ArticleCoverImageType | null;
};

export class ArticleService {
	constructor(private repository: ReturnType<typeof getArticleRepository>) {}

	/**
	 * The slug check reads outside the transaction that writes the content, so two
	 * concurrent requests can both find the slug free and only the second one meets
	 * the `(slug, language)` unique index. Postgres answers that with a bare unique
	 * violation, which the error handler would mask as a 500 - mapped back onto the
	 * same 409 the pre-check raises so the race and the ordinary case read alike.
	 *
	 * The index is matched by name: the table carries a second unique index whose
	 * violation would mean something else entirely.
	 */
	private async withSlugGuard<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (
				RepositoryAbstract.isUniqueViolation(error) &&
				error instanceof QueryFailedError &&
				error.driverError?.constraint === SLUG_UNIQUE_INDEX
			) {
				throw slugConflictError();
			}

			throw error;
		}
	}

	/**
	 * The read shape: `details` traded for the switches it holds, resolved against the
	 * deployment defaults.
	 *
	 * Both read surfaces hand articles out this way. `settings` is a response field rather than
	 * a column - the effective value of three keys, not the storage - so it is assembled here
	 * instead of being set on the entity, which has no such property and would carry it
	 * undefined everywhere else.
	 *
	 * `details` itself does not travel. It is free-form storage the article may hold anything
	 * else in, the public payload is cached and served anonymously, and the dashboard edits the
	 * switches through `settings`.
	 */
	private withSettings<T extends { details: ArticleDetails | null }>(
		entry: T,
	): Omit<T, 'details'> & { settings: ArticleSettings } {
		const { details, ...rest } = entry;

		return {
			...rest,
			settings: resolveArticleSettings(details),
		};
	}

	/**
	 * @description Used in `create` method from controller;
	 *
	 * `authorId` is the signed-in account, passed in rather than read from the payload: it
	 * records who filed the article and is not an editorial choice. The by-line a reader sees
	 * is `contents[].author`, which is per-language and overrides this field by field.
	 * `null` is allowed - the column is nullable so an article survives its author's deletion.
	 */
	public async create(
		data: ValidatorOutput<ArticleValidator, 'create'>,
		authorId: number | null,
	): Promise<ArticleEntity> {
		const conflict = await ArticleContentRepository.findConflictingSlug(
			data.contents,
		);

		if (conflict) {
			throw slugConflictError();
		}

		return this.withSlugGuard(() =>
			dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(ArticleEntity);

				const entrySaved = await repository.save({
					layout: data.layout,
					publish_at: data.publish_at,
					archive_at: data.archive_at,
					featured_status: data.featured_status,
					featured_order: data.featured_order,
					visibility: data.visibility,
					public_at: data.public_at,
					source_mode: data.source_mode,
					source: data.source,
					details: applyArticleSettings(null, data.settings ?? {}),
					author_id: authorId,
				});

				await this.saveRelations(manager, entrySaved, data);

				return entrySaved;
			}),
		);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ArticleEntity> & { id: number },
	): Promise<ArticleEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ArticleEntity, saved.id);

		return saved;
	}

	public async updateDataWithContent(
		entry: ArticleEntity,
		data: ValidatorOutput<ArticleValidator, 'update'>,
	): Promise<ArticleEntity> {
		if (data.contents?.length) {
			const conflict = await ArticleContentRepository.findConflictingSlug(
				data.contents,
				entry.id,
			);

			if (conflict) {
				throw slugConflictError();
			}
		}

		const updatedEntry = await this.withSlugGuard(() =>
			dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(ArticleEntity);

				Object.assign(entry, pickValuesFromObject(data, entryColumns));

				if (data.settings) {
					entry.details = applyArticleSettings(
						entry.details,
						data.settings,
					);
				}

				this.assertPublishWindow(entry);

				this.assertFeaturedWindow(entry);

				const saved = await repository.save(entry);

				await this.saveRelations(manager, saved, data);

				await this.clearRestrictionWhenPublic(manager, saved);

				return saved;
			}),
		);

		/*
		 * One clean for the whole operation, emitted after the transaction commits.
		 *
		 * The contents, link rows and visibility rule written above carry no subscribers of
		 * their own: a row-level hook fires once per row (three translations meant three
		 * identical Redis SCANs) and it fires *inside* the transaction, where a concurrent
		 * reader can refill the cache from a snapshot that is about to be superseded. The
		 * service knows this was one operation on one article, and knows when it committed.
		 * Full reasoning on `cleanEntityCache`.
		 */
		await cleanEntityCache(ArticleEntity, updatedEntry.id);

		return updatedEntry;
	}

	/**
	 * The publish window on the row as it will be saved.
	 *
	 * The validator already rejects a payload that carries both dates inverted, but it only
	 * sees the payload: an update that moves `archive_at` alone is compared against nothing
	 * there. This runs after the merge, where both values are known, and is the check that
	 * actually holds for a partial update.
	 */
	private assertPublishWindow(entry: ArticleEntity): void {
		if (!entry.publish_at || !entry.archive_at) {
			return;
		}

		if (entry.archive_at > entry.publish_at) {
			return;
		}

		throw new CustomError(
			422,
			lang('article.validation.archive_before_publish'),
		);
	}

	/**
	 * The featured window on the row as it will be saved.
	 *
	 * Same division of labor as `assertPublishWindow`: the validator rejects a payload that
	 * states an expiry with no slot, but an update setting the date alone is compared against
	 * nothing there. After the merge both values are known, so this is the check that holds
	 * for a partial update.
	 */
	private assertFeaturedWindow(entry: ArticleEntity): void {
		if (!entry.featured_expire_at || entry.featured_status) {
			return;
		}

		throw new CustomError(
			422,
			lang('article.validation.featured_expire_without_status'),
		);
	}

	/**
	 * Drops an article out of its featured group once `featured_expire_at` has passed.
	 *
	 * All three fields go together: an order position in a group the article has left would
	 * collide with the rows still in it, and a deadline pointing at a slot it no longer holds
	 * reads as still-featured in the form. Re-featuring therefore starts from a clean row.
	 *
	 * Saved through `update`, which drops the cache and lets the audit subscriber record the
	 * write; the explicit event on top of the generic `updated` one is what names the slot that
	 * was given up, which the row itself no longer records.
	 */
	public async expireFeatured(entry: ArticleEntity): Promise<void> {
		const expiredStatus = entry.featured_status;

		entry.featured_status = null;
		entry.featured_order = 0;
		entry.featured_expire_at = null;

		await this.update(entry);

		eventEmitter.emit('history', {
			entity: ArticleEntity.NAME,
			entity_ids: [entry.id],
			action: LogHistoryActionEnum.FEATURED_EXPIRED,
			data: {
				featuredStatus: expiredStatus ?? 'unknown',
			},
		});
	}

	/**
	 * Contents, links and the visibility rule are all optional on update and absent means
	 * "leave alone" - an empty array, on the other hand, clears the links.
	 */
	private async saveRelations(
		manager: EntityManager,
		entry: ArticleEntity,
		data: Partial<ValidatorOutput<ArticleValidator, 'create'>>,
	): Promise<void> {
		await ArticleContentRepository.saveContent(
			manager,
			data.contents ?? [],
			entry.id,
		);

		if (data.categories) {
			await ArticleCategoryRepository.syncLinks(
				manager,
				entry.id,
				data.categories,
			);
		}

		if (data.tags) {
			await ArticleTagRepository.syncLinks(manager, entry.id, data.tags);
		}

		if (data.visibility_rule) {
			await this.saveVisibilityRule(
				manager,
				entry.id,
				data.visibility_rule,
			);
		}
	}

	/**
	 * Public visibility owns no restriction state, so an article moved back to `public` drops
	 * its deadline and its rule row - the same end state the release cron produces.
	 *
	 * This lives here rather than in the payload because a form cannot express it: an optional
	 * date parsed from an absent value comes through as `undefined`, which TypeORM reads as "no
	 * change", so the UI has no way to send "clear this". The rule is derivable from
	 * `visibility` anyway, which makes the server the right place to enforce it.
	 */
	private async clearRestrictionWhenPublic(
		manager: EntityManager,
		entry: ArticleEntity,
	): Promise<void> {
		if (entry.visibility !== ArticleVisibilityEnum.PUBLIC) {
			return;
		}

		if (entry.public_at) {
			entry.public_at = null;

			await manager.getRepository(ArticleEntity).save(entry);
		}

		await manager
			.getRepository(ArticleVisibilityRuleEntity)
			.softDelete({ article_id: entry.id });
	}

	/**
	 * The rule row carries a plain UNIQUE on `article_id`, so a soft-deleted rule keeps its
	 * slot - the existing row is restored and overwritten rather than replaced by a new one.
	 */
	private async saveVisibilityRule(
		manager: EntityManager,
		article_id: number,
		rule: ArticleVisibilityRuleType,
	): Promise<void> {
		const repository = manager.getRepository(ArticleVisibilityRuleEntity);

		const existing = await repository.findOne({
			where: { article_id },
			withDeleted: true,
		});

		const entry = existing ?? repository.create({ article_id });

		entry.deleted_at = null;
		entry.requires_auth = rule.requires_auth;
		entry.requires_subscription = rule.requires_subscription;
		entry.allowed_countries = rule.allowed_countries ?? null;
		entry.is_listed = rule.is_listed;

		// An omitted password leaves the stored hash alone; an empty string clears it
		if (rule.password !== undefined) {
			entry.password = rule.password
				? await encryptPassword(rule.password)
				: null;
		}

		await repository.save(entry);
	}

	/**
	 * Ends an article's restriction: `visibility` goes public, the deadline that scheduled it is
	 * consumed, and the rule row is soft-deleted so a stale password or country list cannot come
	 * back with a later re-restriction.
	 *
	 * One transaction, because a released article still carrying its rule row would read as
	 * restricted to anything that consults the rule before the visibility.
	 *
	 * The `visibility` history entry is emitted on top of the `updated` one the subscriber
	 * writes: the audit trail has to say *what* changed, and a bare "updated" from a cron run
	 * does not distinguish this from an editor saving a typo.
	 */
	public async releaseRestricted(entry: ArticleEntity): Promise<void> {
		await dataSource.transaction(async (manager) => {
			entry.visibility = ArticleVisibilityEnum.PUBLIC;
			entry.public_at = null;

			await manager.getRepository(ArticleEntity).save(entry);

			await manager
				.getRepository(ArticleVisibilityRuleEntity)
				.softDelete({ article_id: entry.id });
		});

		/*
		 * Both the article and its visibility rule are cached under `article:<id>*`, and this
		 * runs from a cron with nobody watching - a stale rule leaves a released article still
		 * reading as gated (or the reverse) for a whole TTL, which is an access-control answer
		 * rather than a cosmetic one.
		 */
		await cleanEntityCache(ArticleEntity, entry.id);

		eventEmitter.emit('history', {
			entity: ArticleEntity.NAME,
			entity_ids: [entry.id],
			action: LogHistoryActionEnum.VISIBILITY,
		});
	}

	public async updateStatus(
		entry: ArticleEntity,
		newStatus: ArticleStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		await this.update(entry);
	}

	/**
	 * Reorders one featured group. `featured_order` is a plain int on the article, so the group
	 * the positions belong to is decided here, not by the column: `section` is every article
	 * carrying that flag, `category` is the articles flagged for a category slot and linked to
	 * the given category **or any of its descendants** - the order page lists a subtree, so the
	 * write has to accept the same set the page showed.
	 *
	 * The submitted ids must be a complete reordering of that set. A subset would silently leave
	 * the untouched rows sharing positions with the moved ones, which reads as a random order.
	 *
	 * Saved row by row through the repository rather than a bulk UPDATE so each write is
	 * audited - same reason as the cron jobs. The cache is dropped for the whole group once,
	 * after the transaction commits.
	 */
	public async updateOrder(
		data: ValidatorOutput<ArticleValidator, 'orderUpdate'>,
	): Promise<void> {
		await dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(ArticleEntity);

			const query = repository
				.createQueryBuilder('article')
				.where('article.featured_status = :featured_status', {
					featured_status: data.featured_status,
				});

			if (data.category_id) {
				const categoryIds = await this.resolveCategorySubtree(
					data.category_id,
				);

				query
					.innerJoin('article.categories', 'link')
					.andWhere('link.category_id IN (:...categoryIds)', {
						categoryIds,
					});
			}

			const entries = await query.getMany();

			const foundIds = new Set(entries.map((entry) => entry.id));
			const allProvidedAreValid = data.positions.every((id) =>
				foundIds.has(id),
			);

			if (
				entries.length !== data.positions.length ||
				!allProvidedAreValid
			) {
				throw new CustomError(
					400,
					lang('article.validation.invalid_ids_provided'),
				);
			}

			// Descending, so the first article in the list carries the highest weight - the
			// same convention `brand.updateOrder` writes and the public listing reads.
			const ordered = entries.map((entry) => {
				entry.featured_order =
					data.positions.length - data.positions.indexOf(entry.id);

				return entry;
			});

			await repository.save(ordered);
		});

		// Every row moved, in one pass: a reorder rewrites the whole group, and the
		// order a reader sees comes from these rows. See `cleanEntityCacheMany`
		await cleanEntityCacheMany(ArticleEntity, data.positions);
	}

	/**
	 * The category and every category beneath it, as ids.
	 *
	 * Every `category_id` filter in this service resolves through here, so "in this category"
	 * means the same thing to the listing, the public feed and `updateOrder`. They have to
	 * agree: the order page lists a subtree and then posts that exact set back, and a write
	 * that recognized only the direct links would reject its own list as incomplete.
	 */
	private async resolveCategorySubtree(
		category_id: number,
	): Promise<number[]> {
		const treeRepository =
			RepositoryAbstract.getTreeRepository(CategoryEntity);

		const category = await treeRepository.findOneOrFail({
			where: { id: category_id },
		});

		const descendants = await treeRepository.findDescendants(category);

		return descendants.map((descendant) => descendant.id);
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<ArticleEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * The two author sources answer different questions and both are kept: `author_id` is the
	 * account that owns the article, `content.author` is the by-line as it should read in that
	 * language. The by-line wins field by field, so a translated bio or a pen name overrides
	 * the account without having to restate the parts it agrees with.
	 *
	 * Applied on the public read only. The dashboard read returns the stored override
	 * untouched, because that is what the editor edits - see `getEntryData`.
	 */
	private resolveAuthor(
		entry: ArticleEntity,
		contentAuthor: ArticleAuthorType | null,
	): ArticleAuthorType | null {
		if (!entry.author && !contentAuthor) {
			return null;
		}

		return {
			...(entry.author
				? { name: entry.author.name, email: entry.author.email }
				: {}),
			...Object.fromEntries(
				Object.entries(contentAuthor ?? {}).filter(
					([, value]) => value !== undefined && value !== null,
				),
			),
		} as ArticleAuthorType;
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: {
		id: number;
		language?: string;
		withDeleted: boolean;
	}) {
		const query = this.repository
			.createQuery()
			.select([
				'article.id',
				'article.status',
				'article.layout',
				'article.publish_at',
				'article.archive_at',
				'article.featured_status',
				'article.featured_order',
				'article.featured_expire_at',
				'article.visibility',
				'article.public_at',
				'article.source_mode',
				'article.source',
				'article.details',
				'article.author_id',
				'article.created_at',
				'article.updated_at',
				'article.deleted_at',

				'content.language',
				'content.slug',
				'content.title',
				'content.brief',
				'content.content',
				'content.author',
				'content.meta',

				'author.id',
				'author.name',
				'author.email',

				'category.category_id',
				'tag.tag_id',

				// The wording behind each link, so a form seeded from this row can show
				// names rather than the bare ids it stores.
				'category_row.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',

				'tag_row.id',
				'tag_content.id',
				'tag_content.language',
				'tag_content.value',
			])
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.joinAndSelect('article.author', 'author', 'LEFT')
			/*
			 * The link joins are pinned to live rows by hand because `withDeleted` reaches
			 * them too: it exists so an admin can read a soft-deleted *article*, but TypeORM
			 * applies it to every joined relation, which brings back the links unlinked in
			 * earlier edits. The form seeds itself from these rows, so a resurrected link
			 * reads as a removal that did not save.
			 */
			.joinAndSelect(
				'article.categories',
				'category',
				'LEFT',
				'category.deleted_at IS NULL',
			)
			.joinAndSelect(
				'article.tags',
				'tag',
				'LEFT',
				'tag.deleted_at IS NULL',
			)
			.join('category.category', 'category_row', 'LEFT')
			.join('tag.tag', 'tag_row', 'LEFT');

		/*
		 * The link wording follows the article's own: asking for one language returns one
		 * label per link, and asking for all returns every translation the caller then picks
		 * from. Both are LEFT joins - a link whose term lost its translation still has to come
		 * back, or the article would silently drop the tag from the form.
		 */
		if (data.language) {
			query
				.joinAndSelect(
					'article.contents',
					'content',
					'INNER',
					'content.language = :language',
					{
						language: data.language,
					},
				)
				.join(
					'category_row.contents',
					'category_content',
					'LEFT',
					'category_content.language = :language',
				)
				.join(
					'tag_row.contents',
					'tag_content',
					'LEFT',
					'tag_content.language = :language',
				);
		} else {
			// No language: take all contents
			query
				.joinAndSelect('article.contents', 'content', 'LEFT')
				.join('category_row.contents', 'category_content', 'LEFT')
				.join('tag_row.contents', 'tag_content', 'LEFT');
		}

		const entry = await query.firstOrFail();

		/*
		 * The by-line is returned exactly as stored, unmerged. This is the editing surface: an
		 * editor has to see which fields the translation actually overrides, and a resolved
		 * value handed to a form comes straight back on the next save - which would bake the
		 * account's name and email into `article_content.author` and turn the fallback into
		 * a frozen copy. `article.author` is selected alongside for anything that wants to
		 * show the filing account.
		 */

		if (entry.visibility === ArticleVisibilityEnum.RESTRICTED) {
			// Loaded separately so the rule's `password` hash never rides along in the
			// selected columns of the main query
			entry.visibility_rule = await dataSource
				.getRepository(ArticleVisibilityRuleEntity)
				.findOne({
					where: { article_id: entry.id },
					select: {
						requires_auth: true,
						requires_subscription: true,
						allowed_countries: true,
						is_listed: true,
					},
				});
		}

		// The form editing an article needs the switches it will post back, defaults included
		return this.withSettings(entry);
	}

	/**
	 * The switches a reader-facing write is checked against, `null` when there is no article to
	 * write to - soft-deleted, or never there. `article.listener.ts` turns that `null` into a
	 * refusal: nothing may be attached to a page nobody can open.
	 *
	 * Cached as a sibling of the public payload (`article:<id>:settings`), so the prefix clean an
	 * edit already runs drops it along with everything else about the row. A `null` is not
	 * cached - `CacheProvider.set` skips it - so a missing article costs one lookup per attempt.
	 */
	public async getSettings(id: number): Promise<ArticleSettings | null> {
		const results = await cacheProvider.get(
			cacheProvider.buildKey(
				ArticleEntity.NAME,
				id.toString(),
				'settings',
			),
			async () => {
				const entry = await this.repository
					.createQuery()
					.select(['article.id', 'article.details'])
					.filterById(id)
					.first();

				return entry ? resolveArticleSettings(entry.details) : null;
			},
		);

		return results.data as ArticleSettings | null;
	}

	/**
	 * @description Used in `publicRead` from controller - the anonymous surface.
	 *
	 * Keyed on the content slug rather than the id: a public URL is `/blog/<slug>`, and the
	 * slug is unique per language. Only the display window is reachable, so a draft or an
	 * archived article answers 404 to a visitor instead of leaking its existence through a
	 * different status code.
	 */
	public resolvePublicRef(
		slug: string,
		language: string,
	): Promise<ArticleAccessTarget> {
		return this.repository
			.createQuery()
			.select(['article.id', 'article.visibility'])
			.join(
				'article.contents',
				'content',
				'INNER',
				'content.language = :language AND content.slug = :slug',
				{ language, slug },
			)
			.filterPublished(true)
			.firstOrFail();
	}

	/**
	 * Attaches each article's cover image, when the deployment has something to answer with.
	 *
	 * Asked of the registry in `target-image.registry.ts` rather than of the `image` feature, which
	 * is optional here. The split of vocabulary is the point: this feature asks for the first
	 * `gallery` image of an article and calls what comes back a cover; picking which one comes
	 * first is the storing feature's rule.
	 *
	 * With no provider registered - a deployment without `image`, or the `test` environment, where
	 * bootstrap does not run - every article answers `null`. The key stays present either way: a
	 * client must not have to tell "no image" apart from "no image feature".
	 */
	private async attachCoverImages<T extends { id: number }>(
		entries: T[],
	): Promise<WithCoverImage<T>[]> {
		if (entries.length === 0) {
			return [];
		}

		const covers = await resolveTargetImages(
			ArticleEntity.NAME,
			TargetImageTypeEnum.GALLERY,
			entries.map((entry) => entry.id),
		);

		return entries.map((entry) => ({
			...entry,
			cover_image: covers.get(entry.id) ?? null,
		}));
	}

	/**
	 * @description Used in `publicRead` from controller, behind the cache.
	 *
	 * Keyed by id rather than slug on purpose: `cleanEntityCache` invalidates by the
	 * `<entity>:<id>*` prefix, so a slug-keyed entry would survive an edit until its TTL.
	 * Resolving the slug first (`resolvePublicRef`) also keeps the publish window and the
	 * visibility out of the cached value - both decide access and both move without the
	 * payload changing.
	 */
	public async getPublicEntryById(id: number, language: string) {
		const entry = await this.repository
			.createQuery()
			.select([
				'article.id',
				'article.status',
				'article.layout',
				'article.publish_at',
				'article.visibility',
				'article.source_mode',
				'article.source',
				'article.details',
				'article.author_id',
				'article.created_at',
				'article.updated_at',

				'content.language',
				'content.slug',
				'content.title',
				'content.brief',
				'content.content',
				'content.author',
				'content.meta',

				'author.id',
				'author.name',

				'category.category_id',
				'tag.tag_id',

				// The category is named, not just linked: the public URL of an article is
				// `/<category-slug>/<article-slug>`, so the reader's own address needs the
				// translation, not only the id.
				'category_entry.id',
				'category_entry_content.id',
				'category_entry_content.language',
				'category_entry_content.label',
				'category_entry_content.slug',
			])
			.joinAndSelect(
				'article.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language },
			)
			.joinAndSelect('article.author', 'author', 'LEFT')
			.joinAndSelect('article.categories', 'category', 'LEFT')
			// Same article-only guard as the listing, so both agree on the category an
			// article's public URL is built from.
			.joinAndSelect(
				'category.category',
				'category_entry',
				'LEFT',
				'category_entry.type = :categoryType',
				{ categoryType: CategoryTypeEnum.ARTICLE },
			)
			.joinAndSelect(
				'category_entry.contents',
				'category_entry_content',
				'LEFT',
				'category_entry_content.language = :language',
			)
			.joinAndSelect('article.tags', 'tag', 'LEFT')
			.filterById(id)
			.firstOrFail();

		for (const content of entry.contents ?? []) {
			content.author = this.resolveAuthor(entry, content.author);
		}

		const [entryWithCover] = await this.attachCoverImages([entry]);

		// The switches tell the page whether to draw a rating widget, a comment form and a
		// report link at all
		return this.withSettings(entryWithCover);
	}

	/**
	 * @description Used in `publicFind` from controller - the anonymous listing.
	 *
	 * A restricted article is listed only while its rule says `is_listed`; a public one is
	 * always listed. The rule is LEFT-joined so a public article with no rule row survives
	 * the condition.
	 */
	public async findByFilterPublic(
		data: ValidatorOutput<ArticleValidator, 'publicFind'>,
	) {
		const query = this.repository
			.createQuery()
			.join(
				'article.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language: data.filter.language },
			)
			.join('article.author', 'author', 'LEFT')
			.join('article.visibility_rule', 'rule', 'LEFT')
			/*
			 * The listing names each article's categories, which live two relations away
			 * (link row -> category -> translation) and are what its public URL is built
			 * from. Selected on the same language as the article translation, so a row
			 * shows one label per category rather than one per language.
			 *
			 * The link is to-many, so these joins multiply the raw rows; pagination
			 * survives it because `getManyAndCount` with skip/take resolves the page as a
			 * distinct-id subquery first. The primary keys are selected for the same
			 * reason - without them TypeORM cannot tell the duplicated rows apart when it
			 * rebuilds the entities.
			 */
			.join(
				'article.categories',
				'article_category',
				'LEFT',
				'article_category.deleted_at IS NULL',
			)
			/*
			 * Article categories only. The link table accepts any category, and demo data
			 * has filed articles under product ones - a category the article site has no
			 * page for. Filtered in the join rather than after it, so such a link comes
			 * back as a link with no category and the article simply shows none.
			 */
			.join(
				'article_category.category',
				'category',
				'LEFT',
				'category.type = :categoryType',
				{ categoryType: CategoryTypeEnum.ARTICLE },
			)
			.join(
				'category.contents',
				'category_content',
				'LEFT',
				'category_content.language = :language',
			)
			.select([
				'article.id',
				'article.publish_at',
				'article.featured_status',
				'article.featured_order',
				'article.visibility',

				'content.language',
				'content.slug',
				'content.title',
				'content.brief',
				'content.author',
				'content.meta',

				'author.id',
				'author.name',

				'article_category.id',
				'article_category.category_id',
				'category.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',
				'category_content.slug',
			])
			.filterBy('article.id', data.filter.id)
			.filterBy('article.featured_status', data.filter.featured_status)
			.filterByTerm(data.filter.term)
			.filterPublished(true)
			.filterRaw(
				`(article.visibility = :publicVisibility OR rule.is_listed = true)`,
				{ publicVisibility: ArticleVisibilityEnum.PUBLIC },
			);

		if (data.filter.category_id) {
			// Its own join: `article_category` above is a LEFT join feeding the label, and
			// narrowing it would turn every listed article into a category match.
			query
				.join('article.categories', 'category_filter', 'INNER')
				.filterRaw('category_filter.category_id IN (:...categoryIds)', {
					categoryIds: await this.resolveCategorySubtree(
						data.filter.category_id,
					),
				});
		}

		if (data.filter.tag_id?.length) {
			/*
			 * Any of the tags, not all of them - the box asks for articles that share
			 * something with this one. The INNER join multiplies an article that matches
			 * several, which pagination absorbs the same way the category filter's does
			 * (see above).
			 */
			query
				.join('article.tags', 'tag', 'INNER')
				.filterBy('tag.tag_id', data.filter.tag_id, 'IN');
		}

		if (data.filter.exclude_id) {
			query.filterBy('article.id', data.filter.exclude_id, '!=');
		}

		const [entries, total] = await query
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);

		return [await this.attachCoverImages(entries), total] as const;
	}

	public async findByFilter(
		data: ValidatorOutput<ArticleValidator, 'find'>,
		withDeleted: boolean,
	) {
		const query = this.repository
			.createQuery()
			.join(
				'article.contents',
				'content',
				'LEFT',
				'content.language = :language',
				{
					language: data.filter.language,
				},
			)
			.join('article.author', 'author', 'LEFT')
			/*
			 * The dashboard list names the categories, which live two relations away (link row ->
			 * category -> translation). Selected on the same language as the article translation,
			 * so a row shows one label per category rather than one per language.
			 *
			 * The link is to-many, so these joins multiply the raw rows; pagination survives it
			 * because `getManyAndCount` with skip/take resolves the page as a distinct-id
			 * subquery first. The primary keys are selected for the same reason - without them
			 * TypeORM cannot tell the duplicated rows apart when it rebuilds the entities.
			 */
			// Pinned to live links for the same reason as `getEntryData`: `withDeleted` is
			// about listing deleted articles, not about naming categories they were
			// unlinked from.
			.join(
				'article.categories',
				'article_category',
				'LEFT',
				'article_category.deleted_at IS NULL',
			)
			/*
			 * Article categories only. The link table accepts any category, and demo data
			 * has filed articles under product ones - a category the article site has no
			 * page for. Filtered in the join rather than after it, so such a link comes
			 * back as a link with no category and the article simply shows none.
			 */
			.join(
				'article_category.category',
				'category',
				'LEFT',
				'category.type = :categoryType',
				{ categoryType: CategoryTypeEnum.ARTICLE },
			)
			.join(
				'category.contents',
				'category_content',
				'LEFT',
				'category_content.language = :language',
			)
			.select([
				'article.id',
				'article.status',
				'article.publish_at',
				'article.archive_at',
				'article.featured_status',
				'article.featured_order',
				'article.visibility',
				'article.source_mode',
				'article.author_id',
				'article.created_at',
				'article.updated_at',
				'article.deleted_at',

				'content.language',
				'content.slug',
				'content.title',
				'content.brief',
				'content.author',
				'content.meta',

				'author.id',
				'author.name',

				'article_category.id',
				'article_category.category_id',
				'category.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',
			])
			.filterById(data.filter.id)
			.filterBy('article.status', data.filter.status)
			.filterBy('article.visibility', data.filter.visibility)
			.filterBy('article.featured_status', data.filter.featured_status)
			.filterBy('article.source_mode', data.filter.source_mode)
			.filterBy('article.author_id', data.filter.author_id)
			.filterByTerm(data.filter.term)
			.filterPublished(data.filter.is_published)
			.withDeleted(withDeleted && data.filter.is_deleted);

		if (data.filter.category_id) {
			// Its own join: `article_category` above is a LEFT join feeding the label, and
			// narrowing it would turn every listed article into a category match.
			query
				.join('article.categories', 'category_filter', 'INNER')
				.filterRaw('category_filter.category_id IN (:...categoryIds)', {
					categoryIds: await this.resolveCategorySubtree(
						data.filter.category_id,
					),
				});
		}

		if (data.filter.tag_id) {
			query
				.join('article.tags', 'tag', 'INNER')
				.filterBy('tag.tag_id', data.filter.tag_id);
		}

		return query
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const articleService = new ArticleService(getArticleRepository());
