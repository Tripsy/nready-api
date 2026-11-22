import { expect, jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import type DiscountTargetEntity from '@/features/discount/discount-target.entity';
import { DiscountTargetService } from '@/features/discount/discount-target.service';
import { mockId } from '@/tests/mocks/uuid.mock';

/**
 * One repository stands in for the whole table now that targets are polymorphic - the previous
 * shape needed a fake data source because it resolved five repositories by table name.
 */
function createRepository(rows: Partial<DiscountTargetEntity>[] = []) {
	const repository = {
		find: jest.fn(async () => rows) as jest.Mock,
		delete: jest.fn(async () => undefined) as jest.Mock,
		insert: jest.fn(async () => undefined) as jest.Mock,
	};

	return {
		repository,
		// `replaceTargets` opens a transaction and takes its repository from the manager.
		asService: {
			...repository,
			manager: {
				transaction: jest.fn(async (runner: unknown) =>
					(runner as (m: unknown) => Promise<void>)({
						getRepository: () => repository,
					}),
				),
			},
		} as unknown as Repository<DiscountTargetEntity>,
	};
}

describe('DiscountTargetService.replaceTargets', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it('replaces only the target types present in the payload', async () => {
		const { repository, asService } = createRepository();
		const service = new DiscountTargetService(asService);

		await service.replaceTargets(mockId(7), { client: [mockId(3)] });

		expect(repository.delete).toHaveBeenCalledTimes(1);
		expect(repository.delete).toHaveBeenCalledWith({
			discount_id: mockId(7),
			target_type: 'client',
		});
		expect(repository.insert).toHaveBeenCalledWith([
			{
				discount_id: mockId(7),
				target_type: 'client',
				entity_id: mockId(3),
			},
		]);
	});

	it('scopes the delete to one target type, leaving the others intact', async () => {
		const { repository, asService } = createRepository();
		const service = new DiscountTargetService(asService);

		await service.replaceTargets(mockId(7), {
			category: [mockId(1)],
			brand: [mockId(2)],
		});

		// One delete per type in the payload, never a blanket delete by discount alone
		expect(repository.delete).toHaveBeenCalledTimes(2);

		for (const call of repository.delete.mock.calls) {
			expect(call).toHaveLength(1);
			expect(call.at(0)).toHaveProperty('target_type');
		}
	});

	it('clears a type when given an empty array', async () => {
		const { repository, asService } = createRepository();
		const service = new DiscountTargetService(asService);

		await service.replaceTargets(mockId(7), { client: [] });

		expect(repository.delete).toHaveBeenCalledWith({
			discount_id: mockId(7),
			target_type: 'client',
		});
		expect(repository.insert).not.toHaveBeenCalled();
	});

	it('collapses duplicate ids', async () => {
		const { repository, asService } = createRepository();
		const service = new DiscountTargetService(asService);

		await service.replaceTargets(mockId(7), {
			client: [mockId(3), mockId(3), mockId(9)],
		});

		expect(repository.insert).toHaveBeenCalledWith([
			{
				discount_id: mockId(7),
				target_type: 'client',
				entity_id: mockId(3),
			},
			{
				discount_id: mockId(7),
				target_type: 'client',
				entity_id: mockId(9),
			},
		]);
	});
});

describe('DiscountTargetService.listTargets', () => {
	it('groups rows by target type', async () => {
		const { asService } = createRepository([
			{ target_type: 'client', entity_id: mockId(3) },
			{ target_type: 'client', entity_id: mockId(9) },
			{ target_type: 'category', entity_id: mockId(12) },
		]);

		const result = await new DiscountTargetService(asService).listTargets(
			mockId(7),
		);

		expect(result.client).toEqual([mockId(3), mockId(9)]);
		expect(result.category).toEqual([mockId(12)]);
		expect(result).not.toHaveProperty('brand');
	});
});
