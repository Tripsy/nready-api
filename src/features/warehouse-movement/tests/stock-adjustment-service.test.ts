import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { grnService, type SiteLot } from '@/features/grn/grn.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';
import StockAdjustmentEntity, {
	StockAdjustmentDirectionEnum,
	StockAdjustmentReasonEnum,
	StockAdjustmentStatusEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import type { StockAdjustmentQuery } from '@/features/warehouse-movement/stock-adjustment.repository';
import {
	planTopUp,
	StockAdjustmentService,
} from '@/features/warehouse-movement/stock-adjustment.service';
import WarehouseMovementEntity, {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import type { EntityId } from '@/shared/types/entity-id.type';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

const WAREHOUSE_ID = mockId(1);
const VARIANT_ID = mockId(6);

function lot(
	id: EntityId,
	qty: number,
	remaining: number,
	cost: number,
	receivedAt: number,
): SiteLot {
	return {
		grn_item_id: id,
		qty: qty,
		qty_remaining: remaining,
		unit_cost_base: cost,
		received_at: receivedAt,
	};
}

/**
 * A transaction manager holding the warehouse, the variant, the adjustments written and the ledger,
 * so a post followed by a reverse reads back exactly what the post wrote.
 */
function fakeManager(
	options: { warehouseActive?: boolean; tracked?: boolean } = {},
) {
	let nextId = 500;
	const adjustments: StockAdjustmentEntity[] = [];
	const ledger: WarehouseMovementEntity[] = [];
	const updates: { id: EntityId; values: object }[] = [];

	const manager = {
		getRepository: jest.fn((target: unknown) => {
			if (target === WarehouseEntity) {
				return {
					findOne: jest.fn(async () => ({
						id: WAREHOUSE_ID,
						status:
							options.warehouseActive === false
								? WarehouseStatusEnum.INACTIVE
								: WarehouseStatusEnum.ACTIVE,
					})),
				};
			}

			if (target === ProductVariantEntity) {
				return {
					findOne: jest.fn(async () => ({
						id: VARIANT_ID,
						track_stock: options.tracked ?? true,
					})),
				};
			}

			if (target === StockAdjustmentEntity) {
				return {
					findOne: jest.fn(
						async (query: { where: { id: EntityId } }) =>
							adjustments.find(
								(row) => row.id === query.where.id,
							) ?? null,
					),
				};
			}

			if (target === WarehouseMovementEntity) {
				return {
					find: jest.fn(
						async (query: { where: { source_id: EntityId } }) =>
							ledger.filter(
								(row) =>
									row.source_id === query.where.source_id &&
									row.reversal_of_id === null,
							),
					),
				};
			}

			throw new Error('unexpected repository');
		}),
		create: jest.fn((_target: unknown, values: object) => values),
		save: jest.fn(async (value: object | object[]) => {
			if (Array.isArray(value)) {
				for (const row of value) {
					ledger.push({
						...(row as WarehouseMovementEntity),
						id: mockId(nextId++),
					});
				}

				return value;
			}

			const row = {
				...(value as StockAdjustmentEntity),
				id: mockId(nextId++),
			};

			adjustments.push(row);

			return row;
		}),
		update: jest.fn(
			async (
				_target: unknown,
				where: { id: EntityId },
				values: object,
			) => {
				updates.push({ id: where.id, values: values });

				const row = adjustments.find((entry) => entry.id === where.id);

				if (row) {
					Object.assign(row, values);
				}
			},
		),
	};

	return {
		manager: manager as unknown as EntityManager,
		adjustments,
		ledger,
		updates,
	};
}

describe('planTopUp', () => {
	const lots = [
		lot(mockId(1), 10, 10, 20, 1), // full - no room
		lot(mockId(2), 30, 25, 21, 2), // room 5
		lot(mockId(3), 20, 12, 22, 3), // room 8, newest
	];

	it('fills the newest receipt first, at its own cost', () => {
		expect(planTopUp(lots, 6)).toEqual([
			{ grn_item_id: mockId(3), qty: 6, unit_cost_base: 22 },
		]);
	});

	it('spills into older lots with room once the newest is full', () => {
		expect(planTopUp(lots, 11)).toEqual([
			{ grn_item_id: mockId(3), qty: 8, unit_cost_base: 22 },
			{ grn_item_id: mockId(2), qty: 3, unit_cost_base: 21 },
		]);
	});

	it('is null when the room is smaller than the surplus', () => {
		expect(planTopUp(lots, 14)).toBeNull();
	});
});

describe('StockAdjustmentService', () => {
	const mockRepository = createMockRepository<
		StockAdjustmentEntity,
		StockAdjustmentQuery
	>();
	const service = new StockAdjustmentService(
		mockRepository.repository as never,
	);

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const removal = (
		reason: (typeof StockAdjustmentReasonEnum)[keyof typeof StockAdjustmentReasonEnum],
		qty: number,
	) => ({
		warehouse_id: WAREHOUSE_ID,
		variant_id: VARIANT_ID,
		direction: StockAdjustmentDirectionEnum.REMOVE,
		qty: qty,
		reason: reason,
		notes: undefined,
	});

	const addition = (
		reason: (typeof StockAdjustmentReasonEnum)[keyof typeof StockAdjustmentReasonEnum],
		qty: number,
	) => ({
		...removal(reason, qty),
		direction: StockAdjustmentDirectionEnum.ADD,
	});

	describe('createWithin - remove', () => {
		it('draws oldest first and posts a write_off per lot for a loss, at its cost', async () => {
			const { manager, adjustments, ledger } = fakeManager();

			const consume = jest
				.spyOn(grnService, 'consumeLots')
				.mockResolvedValue([
					{
						key: mockId(0),
						grn_item_id: mockId(8),
						variant_id: VARIANT_ID,
						qty: 10,
						unit_cost_base: 41.2,
					},
					{
						key: mockId(0),
						grn_item_id: mockId(15),
						variant_id: VARIANT_ID,
						qty: 2,
						unit_cost_base: 43.9,
					},
				]);

			const id = await service.createWithin(
				manager,
				removal(StockAdjustmentReasonEnum.DAMAGED, 12),
			);

			expect(consume).toHaveBeenCalledWith(manager, WAREHOUSE_ID, [
				{ key: VARIANT_ID, variant_id: VARIANT_ID, quantity: 12 },
			]);
			expect(adjustments).toHaveLength(1);
			expect(adjustments[0]).toMatchObject({
				id: id,
				reason: StockAdjustmentReasonEnum.DAMAGED,
				qty: -12,
				status: StockAdjustmentStatusEnum.CREATED,
			});
			expect(
				ledger.map((row) => [
					row.movement_type,
					row.qty,
					row.grn_item_id,
					row.unit_cost_base,
					row.source_type,
					row.source_id,
				]),
			).toEqual([
				[
					WarehouseMovementTypeEnum.WRITE_OFF,
					-10,
					mockId(8),
					41.2,
					WarehouseMovementSourceEnum.ADJUSTMENT,
					id,
				],
				[
					WarehouseMovementTypeEnum.WRITE_OFF,
					-2,
					mockId(15),
					43.9,
					WarehouseMovementSourceEnum.ADJUSTMENT,
					id,
				],
			]);
		});

		it('posts an audit shortfall as an adjustment, not a loss', async () => {
			const { manager, ledger } = fakeManager();

			jest.spyOn(grnService, 'consumeLots').mockResolvedValue([
				{
					key: mockId(0),
					grn_item_id: mockId(8),
					variant_id: VARIANT_ID,
					qty: 2,
					unit_cost_base: 41.2,
				},
			]);

			await service.createWithin(
				manager,
				removal(StockAdjustmentReasonEnum.AUDIT, 2),
			);

			expect(ledger.map((row) => [row.movement_type, row.qty])).toEqual([
				[WarehouseMovementTypeEnum.ADJUSTMENT, -2],
			]);
		});

		it('refuses a variant that does not track stock', async () => {
			const { manager } = fakeManager({ tracked: false });
			const consume = jest.spyOn(grnService, 'consumeLots');

			await expect(
				service.createWithin(
					manager,
					removal(StockAdjustmentReasonEnum.LOST, 1),
				),
			).rejects.toMatchObject({ statusCode: 422 });
			expect(consume).not.toHaveBeenCalled();
		});

		it('refuses an inactive warehouse', async () => {
			const { manager } = fakeManager({ warehouseActive: false });

			await expect(
				service.createWithin(
					manager,
					removal(StockAdjustmentReasonEnum.LOST, 1),
				),
			).rejects.toMatchObject({ statusCode: 422 });
		});
	});

	describe('createWithin - add', () => {
		const siteLots = [
			lot(mockId(8), 10, 4, 41.2, 1),
			lot(mockId(15), 20, 16, 43.9, 2),
		];

		it('tops up the newest lot with room, as an adjustment', async () => {
			const { manager, adjustments, ledger } = fakeManager();

			jest.spyOn(grnService, 'lockSiteLots').mockResolvedValue(siteLots);
			const restore = jest
				.spyOn(grnService, 'restoreLots')
				.mockResolvedValue();
			const consume = jest.spyOn(grnService, 'consumeLots');

			await service.createWithin(
				manager,
				addition(StockAdjustmentReasonEnum.SAMPLE_RETURNED, 3),
			);

			expect(consume).not.toHaveBeenCalled();
			expect(restore).toHaveBeenCalledWith(manager, [
				expect.objectContaining({ grn_item_id: mockId(15), qty: 3 }),
			]);
			expect(adjustments[0]).toMatchObject({
				qty: 3,
				reason: StockAdjustmentReasonEnum.SAMPLE_RETURNED,
			});
			expect(
				ledger.map((row) => [
					row.movement_type,
					row.qty,
					row.grn_item_id,
				]),
			).toEqual([[WarehouseMovementTypeEnum.ADJUSTMENT, 3, mockId(15)]]);
		});

		it('refuses more than the lots have room for', async () => {
			const { manager, adjustments } = fakeManager();

			jest.spyOn(grnService, 'lockSiteLots').mockResolvedValue(siteLots);
			const restore = jest.spyOn(grnService, 'restoreLots');

			// Room is 6 + 4 = 10
			await expect(
				service.createWithin(
					manager,
					addition(StockAdjustmentReasonEnum.FOUND, 11),
				),
			).rejects.toMatchObject({ statusCode: 409 });
			expect(restore).not.toHaveBeenCalled();
			expect(adjustments).toHaveLength(0);
		});
	});

	describe('reverse', () => {
		function useManager(manager: EntityManager) {
			jest.spyOn(dataSource, 'transaction').mockImplementation((async (
				callback: (manager: EntityManager) => Promise<unknown>,
			) => callback(manager)) as never);
			jest.spyOn(service, 'findById').mockResolvedValue({} as never);
		}

		it('puts written-off units back into the lots they left', async () => {
			const fake = fakeManager();

			jest.spyOn(grnService, 'consumeLots').mockResolvedValue([
				{
					key: mockId(0),
					grn_item_id: mockId(8),
					variant_id: VARIANT_ID,
					qty: 3,
					unit_cost_base: 41.2,
				},
			]);

			const id = await service.createWithin(
				fake.manager,
				removal(StockAdjustmentReasonEnum.EXPIRED, 3),
			);

			useManager(fake.manager);
			const restore = jest
				.spyOn(grnService, 'restoreLots')
				.mockResolvedValue();
			const withdraw = jest.spyOn(grnService, 'withdrawFromLots');

			await service.reverse(id);

			expect(restore).toHaveBeenCalledWith(fake.manager, [
				{ grn_item_id: mockId(8), qty: 3 },
			]);
			expect(withdraw).not.toHaveBeenCalled();

			const reversal = fake.ledger[fake.ledger.length - 1];

			expect(reversal).toMatchObject({
				movement_type: WarehouseMovementTypeEnum.ADJUSTMENT,
				qty: 3,
				grn_item_id: mockId(8),
				reversal_of_id: fake.ledger[0].id,
				source_id: id,
			});
			expect(fake.adjustments[0].status).toBe(
				StockAdjustmentStatusEnum.REVERSED,
			);
		});

		it('takes topped-up units back out of the lots they went into', async () => {
			const fake = fakeManager();

			jest.spyOn(grnService, 'lockSiteLots').mockResolvedValue([
				lot(mockId(15), 20, 16, 43.9, 2),
			]);
			jest.spyOn(grnService, 'restoreLots').mockResolvedValue();

			const id = await service.createWithin(
				fake.manager,
				addition(StockAdjustmentReasonEnum.AUDIT, 2),
			);

			useManager(fake.manager);
			const withdraw = jest
				.spyOn(grnService, 'withdrawFromLots')
				.mockResolvedValue();

			await service.reverse(id);

			expect(withdraw).toHaveBeenCalledWith(fake.manager, [
				{ grn_item_id: mockId(15), qty: 2 },
			]);
			expect(fake.ledger[fake.ledger.length - 1]).toMatchObject({
				qty: -2,
				reversal_of_id: fake.ledger[0].id,
			});
		});

		it('refuses a second reversal', async () => {
			const fake = fakeManager();

			jest.spyOn(grnService, 'consumeLots').mockResolvedValue([]);

			const id = await service.createWithin(
				fake.manager,
				removal(StockAdjustmentReasonEnum.THEFT, 1),
			);

			useManager(fake.manager);
			jest.spyOn(grnService, 'restoreLots').mockResolvedValue();

			await service.reverse(id);

			await expect(service.reverse(id)).rejects.toMatchObject({
				statusCode: 409,
			});
		});
	});
});
