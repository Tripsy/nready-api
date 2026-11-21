import { expect, jest } from '@jest/globals';
import ImageEntity, {
	ImageSectionEnum,
	type ImageStatus,
	ImageStatusEnum,
	ImageTypeEnum,
} from '@/features/image/image.entity';
import {
	getImageEntityMock,
	imageInputPayloads,
	imageOutputPayloads,
} from '@/features/image/image.mock';
import type { ImageQuery } from '@/features/image/image.repository';
import { ImageService } from '@/features/image/image.service';
import type { ImageValidator } from '@/features/image/image.validator';
import { ImageContentRepository } from '@/features/image/image-content.repository';
import {
	createMockRepository,
	setupTransactionMock,
	testServiceDelete,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceUpdateStatus,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

describe('ImageService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockImage = createMockRepository<ImageEntity, ImageQuery>();
	const serviceImage = new ImageService(mockImage.repository);

	it('should create entry inside transaction and save content', async () => {
		const entity = getImageEntityMock();
		const createData = imageOutputPayloads.create;

		const { transaction } = setupTransactionMock(mockImage.repository);

		mockImage.repository.save.mockResolvedValue(entity);

		jest.spyOn(ImageContentRepository, 'saveContent').mockResolvedValue(
			undefined,
		);

		const result = await serviceImage.create(createData);

		expect(transaction).toHaveBeenCalled();

		expect(mockImage.repository.save).toHaveBeenCalledWith({
			section: createData.section,
			entity_id: createData.entity_id,
			image_type: createData.image_type,
			storage: createData.storage,
			path: createData.path,
			properties: createData.properties,
			sort_order: createData.sort_order,
		});

		expect(result).toBe(entity);
	});

	testServiceUpdateStatus<ImageEntity, ImageStatus>(
		serviceImage,
		mockImage.repository,
		{
			good: {
				from: ImageStatusEnum.INACTIVE,
				to: ImageStatusEnum.ACTIVE,
			},
			bad: undefined,
		},
	);

	it('updateOrder - success', async () => {
		const orderData = imageOutputPayloads.orderUpdate;

		const { transaction } = setupTransactionMock(mockImage.repository);

		// The service loads the images by id, rejects the request if any is missing, then
		// saves them back with their new sort_order - so the builder has to return one
		// image per requested position.
		const images = orderData.positions.map((position) => ({
			...getImageEntityMock(),
			id: position.id,
			sort_order: 0,
		}));

		mockImage.queryBuilder.getMany.mockResolvedValue(images);

		await serviceImage.updateOrder(
			orderData.section,
			orderData.entity_id,
			orderData.positions,
		);

		expect(transaction).toHaveBeenCalled();

		expect(mockImage.repository.save).toHaveBeenCalledWith(
			orderData.positions.map((position) =>
				expect.objectContaining({
					id: position.id,
					sort_order: position.sort_order,
				}),
			),
		);
	});

	testServiceFindById<ImageEntity, ImageQuery>(mockImage.query, serviceImage);

	testServiceFindByFilter<ImageEntity, ImageQuery, ImageValidator>(
		mockImage.query,
		serviceImage,
		imageInputPayloads.find,
	);

	// `image` hard-deletes (`.delete(false)`) rather than soft-deleting.
	testServiceDelete<ImageEntity, ImageQuery>(mockImage.query, serviceImage, [
		false,
	]);

	describe('getPrimaryByTargets', () => {
		it('should keep the highest sort_order per target', async () => {
			const first = {
				...getImageEntityMock(),
				id: mockId(10),
				entity_id: mockId(7),
				sort_order: 5,
			};
			const later = {
				...getImageEntityMock(),
				id: mockId(11),
				entity_id: mockId(7),
				sort_order: 0,
			};
			const other = {
				...getImageEntityMock(),
				id: mockId(12),
				entity_id: mockId(8),
				sort_order: 2,
			};

			// The query orders `sort_order DESC`, so the service sees them in this order and the
			// first one it meets for a target is the one that stands for it.
			mockImage.query.all.mockResolvedValue([
				first,
				later,
				other,
			] as unknown as [ImageEntity[], number]);

			const primary = await serviceImage.getPrimaryByTargets(
				ImageSectionEnum.ARTICLE,
				ImageTypeEnum.GALLERY,
				[mockId(7), mockId(8)],
			);

			expect(primary.get(mockId(7))?.id).toBe(mockId(10));
			expect(primary.get(mockId(8))?.id).toBe(mockId(12));
			expect(primary.size).toBe(2);
		});

		/*
		 * The direction itself, not just the picking. The rows above arrive pre-sorted from a
		 * mocked query, so nothing there would notice the `orderBy` flipping - and flipping it is
		 * exactly how the cover silently becomes the image an editor dragged to the *end* of the
		 * gallery. The manager stamps `length - index` and lists descending, so the highest number
		 * is the one it shows first.
		 */
		it('should ask the database for the highest sort_order first', async () => {
			mockImage.query.orderBy.mockClear();
			mockImage.query.all.mockResolvedValue(
				[] as unknown as [ImageEntity[], number],
			);

			await serviceImage.getPrimaryByTargets(
				ImageSectionEnum.ARTICLE,
				ImageTypeEnum.GALLERY,
				[mockId(7)],
			);

			expect(mockImage.query.orderBy).toHaveBeenCalledWith(
				'image.sort_order',
				'DESC',
			);
		});

		it('should leave a target with no image of that type out of the map', async () => {
			mockImage.query.all.mockResolvedValue(
				[] as unknown as [ImageEntity[], number],
			);

			const primary = await serviceImage.getPrimaryByTargets(
				ImageSectionEnum.ARTICLE,
				ImageTypeEnum.GALLERY,
				[mockId(7)],
			);

			expect(primary.has(mockId(7))).toBe(false);
		});

		// An `IN ()` would be a syntax error, so the guard has to come before the query.
		it('should not query for an empty set of ids', async () => {
			mockImage.query.all.mockClear();

			const primary = await serviceImage.getPrimaryByTargets(
				ImageSectionEnum.ARTICLE,
				ImageTypeEnum.GALLERY,
				[],
			);

			expect(primary.size).toBe(0);
			expect(mockImage.query.all).not.toHaveBeenCalled();
		});
	});
});
