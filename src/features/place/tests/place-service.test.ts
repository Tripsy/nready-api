import { expect, jest } from '@jest/globals';

import type PlaceEntity from '@/features/place/place.entity';
import {
	getPlaceEntityMock,
	placeInputPayloads,
	placeOutputPayloads,
} from '@/features/place/place.mock';
import type { PlaceQuery } from '@/features/place/place.repository';
import { PlaceService } from '@/features/place/place.service';
import type { PlaceValidator } from '@/features/place/place.validator';
import { PlaceContentRepository } from '@/features/place/place-content.repository';
import {
	createMockRepository,
	setupTransactionMock,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceRestore,
} from '@/tests/jest-service.setup';

describe('PlaceService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockPlace = createMockRepository<PlaceEntity, PlaceQuery>();

	const servicePlace = new PlaceService(mockPlace.repository);

	it('should create entry inside transaction and save content', async () => {
		const entity = getPlaceEntityMock();
		const createData = placeOutputPayloads.create;

		const { manager, transaction } = setupTransactionMock();

		(manager.getRepository as jest.Mock).mockReturnValue(
			mockPlace.repository,
		);

		mockPlace.repository.save.mockResolvedValue(entity);

		jest.spyOn(PlaceContentRepository, 'saveContent').mockResolvedValue(
			undefined,
		);

		const result = await servicePlace.create(createData);

		expect(transaction).toHaveBeenCalled();

		expect(mockPlace.repository.save).toHaveBeenCalledWith({
			place_type: createData.place_type,
			code: createData.code,
			alpha2_code: createData.alpha2_code,
			parent_id: createData.parent_id,
		});

		expect(result).toBe(entity);
	});

	testServiceFindById<PlaceEntity, PlaceQuery>(mockPlace.query, servicePlace);

	testServiceFindByFilter<PlaceEntity, PlaceQuery, PlaceValidator>(
		mockPlace.query,
		servicePlace,
		placeInputPayloads.find,
	);

	it('should delete when has no children', async () => {
		jest.spyOn(servicePlace, 'hasChildren').mockResolvedValue(undefined);

		mockPlace.query.delete.mockResolvedValue(1);

		await servicePlace.delete(1);

		expect(mockPlace.query.delete).toHaveBeenCalled();
	});

	testServiceRestore<PlaceEntity, PlaceQuery>(mockPlace.query, servicePlace);
});
