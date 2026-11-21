import { expect, jest } from '@jest/globals';
import type BrandEntity from '@/features/brand/brand.entity';
import {
	type BrandStatus,
	BrandStatusEnum,
	BrandTypeEnum,
} from '@/features/brand/brand.entity';
import {
	brandInputPayloads,
	brandOutputPayloads,
	getBrandEntityMock,
} from '@/features/brand/brand.mock';
import type { BrandQuery } from '@/features/brand/brand.repository';
import { BrandService } from '@/features/brand/brand.service';
import type { BrandValidator } from '@/features/brand/brand.validator';
import { BrandContentRepository } from '@/features/brand/brand-content.repository';
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

describe('BrandService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockBrand = createMockRepository<BrandEntity, BrandQuery>();
	const serviceBrand = new BrandService(mockBrand.repository);

	it('should create entry inside transaction and save content', async () => {
		const entity = getBrandEntityMock();
		const createData = brandOutputPayloads.create;

		const { transaction } = setupTransactionMock(mockBrand.repository);

		mockBrand.repository.save.mockResolvedValue(entity);

		jest.spyOn(BrandContentRepository, 'saveContent').mockResolvedValue(
			undefined,
		);

		const result = await serviceBrand.create(createData);

		expect(transaction).toHaveBeenCalled();

		expect(mockBrand.repository.save).toHaveBeenCalledWith({
			name: createData.name,
			slug: createData.slug,
			brand_type: createData.brand_type,
		});

		expect(result).toBe(entity);
	});

	testServiceUpdateStatus<BrandEntity, BrandStatus>(
		serviceBrand,
		mockBrand.repository,
		{
			good: {
				from: BrandStatusEnum.INACTIVE,
				to: BrandStatusEnum.ACTIVE,
			},
			bad: undefined,
		},
	);

	it('updateOrder - success', async () => {
		const { transaction, manager } = setupTransactionMock();

		// The submitted ids must be a complete reordering of the active set
		// for this brand_type; `updateOrder` loads those rows and saves them
		// via the repository so each write is audited, then drops their cache.
		const activeBrands = [
			{ id: mockId(1), sort_order: 0 },
			{ id: mockId(2), sort_order: 0 },
		];

		const queryBuilder = {
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			getMany: jest
				.fn<() => Promise<unknown>>()
				.mockResolvedValue(activeBrands),
		};

		const brandRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
			save: jest
				.fn<() => Promise<unknown>>()
				.mockResolvedValue(activeBrands),
		};

		manager.getRepository.mockReturnValue(brandRepository);

		await serviceBrand.updateOrder(BrandTypeEnum.PRODUCT, [
			mockId(1),
			mockId(2),
		]);

		expect(transaction).toHaveBeenCalled();
		expect(brandRepository.createQueryBuilder).toHaveBeenCalledWith(
			'brand',
		);
		expect(brandRepository.save).toHaveBeenCalled();
	});

	testServiceFindById<BrandEntity, BrandQuery>(mockBrand.query, serviceBrand);

	it('should find entity by slug', async () => {
		const entity = getBrandEntityMock();

		mockBrand.query.first.mockResolvedValue(entity);

		const result = await serviceBrand.findBySlug(
			entity.slug,
			entity.brand_type,
		);

		expect(mockBrand.query.first).toHaveBeenCalled();
		expect(result).toBe(entity);
	});

	testServiceFindByFilter<BrandEntity, BrandQuery, BrandValidator>(
		mockBrand.query,
		serviceBrand,
		brandInputPayloads.find,
	);

	testServiceDelete<BrandEntity, BrandQuery>(mockBrand.query, serviceBrand);

	testServiceRestore<BrandEntity, BrandQuery>(mockBrand.query, serviceBrand);
});
