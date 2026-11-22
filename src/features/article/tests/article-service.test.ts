import { expect, jest } from '@jest/globals';
import type ArticleEntity from '@/features/article/article.entity';
import {
	type ArticleStatus,
	ArticleStatusEnum,
} from '@/features/article/article.entity';
import {
	articleInputPayloads,
	articleOutputPayloads,
	getArticleEntityMock,
} from '@/features/article/article.mock';
import type { ArticleQuery } from '@/features/article/article.repository';
import { ArticleService } from '@/features/article/article.service';
import type { ArticleValidator } from '@/features/article/article.validator';
import { ArticleCategoryRepository } from '@/features/article/article-category.repository';
import { ArticleContentRepository } from '@/features/article/article-content.repository';
import { ArticleTagRepository } from '@/features/article/article-tag.repository';
import { cacheProvider } from '@/providers/cache.provider';
import {
	createMockRepository,
	setupTransactionMock,
	testServiceDelete,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceRestore,
	testServiceUpdateStatus,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

describe('ArticleService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	/** The signed-in account `create` stamps onto `author_id`. */
	const AUTHOR_ID = mockId(7);

	const mockArticle = createMockRepository<ArticleEntity, ArticleQuery>();
	const serviceArticle = new ArticleService(mockArticle.repository);

	function stubRelationWrites() {
		jest.spyOn(ArticleContentRepository, 'saveContent').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ArticleCategoryRepository, 'syncLinks').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ArticleTagRepository, 'syncLinks').mockResolvedValue(
			undefined,
		);
	}

	it('should create entry inside transaction and save its relations', async () => {
		const entity = getArticleEntityMock();
		const createData = articleOutputPayloads.create;

		const { transaction } = setupTransactionMock(mockArticle.repository);

		mockArticle.repository.save.mockResolvedValue(entity);

		jest.spyOn(
			ArticleContentRepository,
			'findConflictingSlug',
		).mockResolvedValue(null);

		stubRelationWrites();

		const result = await serviceArticle.create(createData, AUTHOR_ID);

		expect(transaction).toHaveBeenCalled();

		expect(ArticleContentRepository.saveContent).toHaveBeenCalledWith(
			expect.anything(),
			createData.contents,
			entity.id,
		);
		expect(ArticleCategoryRepository.syncLinks).toHaveBeenCalledWith(
			expect.anything(),
			entity.id,
			articleInputPayloads.create.categories,
		);
		expect(ArticleTagRepository.syncLinks).toHaveBeenCalledWith(
			expect.anything(),
			entity.id,
			articleInputPayloads.create.tags,
		);

		expect(result).toBe(entity);
	});

	it('should reject a create whose slug belongs to another article', async () => {
		jest.spyOn(
			ArticleContentRepository,
			'findConflictingSlug',
		).mockResolvedValue({ id: mockId(99) } as never);

		await expect(
			serviceArticle.create(articleOutputPayloads.create, AUTHOR_ID),
		).rejects.toMatchObject({ statusCode: 409 });
	});

	it('should leave links untouched when the update omits them', async () => {
		const entity = getArticleEntityMock();

		setupTransactionMock(mockArticle.repository);

		mockArticle.repository.save.mockResolvedValue(entity);

		jest.spyOn(
			ArticleContentRepository,
			'findConflictingSlug',
		).mockResolvedValue(null);

		stubRelationWrites();

		// `tags` absent means "leave alone"; an empty array would clear them
		await serviceArticle.updateDataWithContent(entity, {
			id: entity.id,
			featured_order: 5,
		} as never);

		expect(ArticleCategoryRepository.syncLinks).not.toHaveBeenCalled();
		expect(ArticleTagRepository.syncLinks).not.toHaveBeenCalled();
	});

	it('should clean the article cache once per update, after the transaction', async () => {
		const entity = getArticleEntityMock();

		setupTransactionMock(mockArticle.repository);

		mockArticle.repository.save.mockResolvedValue(entity);

		jest.spyOn(
			ArticleContentRepository,
			'findConflictingSlug',
		).mockResolvedValue(null);

		stubRelationWrites();

		const cleans: string[] = [];

		jest.spyOn(cacheProvider, 'deleteByPattern').mockImplementation(
			async (pattern: string) => {
				cleans.push(pattern);
			},
		);

		// Three link changes in one call - the clean is per operation, not per row
		await serviceArticle.updateDataWithContent(entity, {
			id: entity.id,
			categories: [mockId(1), mockId(2)],
			tags: [mockId(3), mockId(4)],
		} as never);

		expect(cleans).toEqual([
			`${cacheProvider.buildKey('article', entity.id.toString())}*`,
		]);
	});

	testServiceUpdateStatus<ArticleEntity, ArticleStatus>(
		serviceArticle,
		mockArticle.repository,
		{
			good: {
				from: ArticleStatusEnum.DRAFT,
				to: ArticleStatusEnum.PENDING,
			},
			bad: {
				from: ArticleStatusEnum.DRAFT,
				to: ArticleStatusEnum.PUBLISHED,
			},
		},
	);

	testServiceFindById<ArticleEntity, ArticleQuery>(
		mockArticle.query,
		serviceArticle,
	);

	testServiceFindByFilter<ArticleEntity, ArticleQuery, ArticleValidator>(
		mockArticle.query,
		serviceArticle,
		articleInputPayloads.find,
	);

	testServiceDelete<ArticleEntity, ArticleQuery>(
		mockArticle.query,
		serviceArticle,
	);

	testServiceRestore<ArticleEntity, ArticleQuery>(
		mockArticle.query,
		serviceArticle,
	);
});
