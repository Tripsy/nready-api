import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import type {
	CategoryContentInput,
	CategoryType,
} from '@/features/category/category.entity';
import CategoryContentEntity from '@/features/category/category-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class CategoryContentQuery extends RepositoryAbstract<CategoryContentEntity> {
	constructor(repository: Repository<CategoryContentEntity>) {
		super(repository, CategoryContentEntity.NAME);
	}
}

export const CategoryContentRepository = dataSource
	.getRepository(CategoryContentEntity)
	.extend({
		createQuery() {
			return new CategoryContentQuery(this);
		},

		async checkSlugLanguageConflict(
			manager: EntityManager,
			contents: CategoryContentInput[],
			category_id: EntityId,
			type: CategoryType,
		) {
			const pairs = Array.from(
				new Map(
					contents
						.filter((c) => c.slug)
						.map((c) => [`${c.slug}:${c.language}`, c]),
				).values(),
			);

			if (!pairs.length) {
				return;
			}

			const tupleSql = pairs
				.map((_, i) => `(:slug_${i}, :lang_${i})`)
				.join(', ');

			const params = pairs.reduce<Record<string, string>>((acc, c, i) => {
				acc[`slug_${i}`] = c.slug;
				acc[`lang_${i}`] = c.language;
				return acc;
			}, {});

			const conflict = await manager
				.createQueryBuilder(CategoryContentEntity, 'cc')
				.where('cc.type = :type', { type })
				.andWhere(`(cc.slug, cc.language) IN (${tupleSql})`, params)
				.andWhere('cc.category_id != :category_id', { category_id })
				.getOne();

			if (conflict) {
				throw new CustomError(
					409,
					lang('category.error.already_exist', {
						slug: conflict.slug,
						language: conflict.language,
					}),
				);
			}
		},

		async saveContent(
			manager: EntityManager,
			contents: CategoryContentInput[],
			category_id: EntityId,
			type: CategoryType,
		) {
			if (!contents.length) {
				return;
			}

			await this.checkSlugLanguageConflict(
				manager,
				contents,
				category_id,
				type,
			);

			try {
				await manager
					.createQueryBuilder()
					.insert()
					.into(CategoryContentEntity)
					.values(
						contents.map((c) => ({
							category_id: category_id,
							language: c.language,
							type: type,
							label: c.label,
							slug: c.slug,
							description: c.description,
							meta: c.meta,
						})),
					)
					.orUpdate(
						['label', 'slug', 'description', 'meta'],
						['category_id', 'language'],
					)
					.execute();
			} catch (e) {
				if (RepositoryAbstract.isUniqueViolation(e)) {
					throw new CustomError(
						409,
						lang('category.error.already_exist'),
					);
				}
				throw e;
			}
		},
	});

export default CategoryContentRepository;
