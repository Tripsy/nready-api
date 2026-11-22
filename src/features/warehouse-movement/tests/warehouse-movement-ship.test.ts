import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { grnService, type LotPiece } from '@/features/grn/grn.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { ShippingScopeEnum } from '@/features/shipping/shipping.entity';
import type { ShippingStockMove } from '@/features/shipping/shipping.hooks';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import { stockReservationService } from '@/features/warehouse-movement/stock-reservation.service';
import WarehouseMovementEntity, {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import type { WarehouseMovementQuery } from '@/features/warehouse-movement/warehouse-movement.repository';
import { WarehouseMovementService } from '@/features/warehouse-movement/warehouse-movement.service';
import type { EntityId } from '@/shared/types/entity-id.type';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

const WAREHOUSE_ID = mockId(1);

const move: ShippingStockMove = {
	shipping_id: mockId(42),
	order_id: mockId(41),
	scope: ShippingScopeEnum.DELIVERY,
	pickup_warehouse_id: WAREHOUSE_ID,
	destination_warehouse_id: null,
};

type Line = {
	id: EntityId;
	variant_id: EntityId;
	quantity: string;
	condition: null;
};

/**
 * A transaction manager holding a delivery's lines and the ledger rows written so far, so a ship
 * followed by a return reads back exactly what the ship posted.
 */
function fakeManager(lines: Line[], tracked: number[]) {
	let nextId = 900;
	const ledger: WarehouseMovementEntity[] = [];

	const manager = {
		getRepository: jest.fn((target: unknown) => {
			if (target === ShippingLineEntity) {
				return { find: jest.fn(async () => lines) };
			}

			if (target === ProductVariantEntity) {
				return {
					find: jest.fn(async () =>
						tracked.map((id) => ({ id: mockId(id) })),
					),
				};
			}

			if (target === WarehouseMovementEntity) {
				return {
					find: jest.fn(
						async (options: {
							where: Record<
								string,
								{ value?: EntityId[] } | string
							>;
						}) => {
							const reversalOf = options.where.reversal_of_id as
								| { value: EntityId[] }
								| undefined;

							if (reversalOf) {
								return ledger.filter(
									(row) =>
										row.reversal_of_id !== null &&
										reversalOf.value.includes(
											row.reversal_of_id,
										),
								);
							}

							const sources = (
								options.where.source_id as { value: EntityId[] }
							).value;

							return ledger.filter(
								(row) =>
									row.movement_type ===
										WarehouseMovementTypeEnum.SALE &&
									row.source_id !== null &&
									sources.includes(row.source_id),
							);
						},
					),
				};
			}

			throw new Error('unexpected repository');
		}),
		create: jest.fn((_target: unknown, values: object) => values),
		save: jest.fn(async (rows: WarehouseMovementEntity[]) => {
			for (const row of rows) {
				ledger.push({
					...row,
					id: mockId(nextId++),
				} as WarehouseMovementEntity);
			}

			return rows;
		}),
	};

	return { manager: manager as unknown as EntityManager, ledger };
}

describe('WarehouseMovementService - ship and come back undelivered', () => {
	const mockMovement = createMockRepository<
		WarehouseMovementEntity,
		WarehouseMovementQuery
	>();
	const service = new WarehouseMovementService(
		mockMovement.repository as never,
	);

	// Two lines of the same shirt (a bundle component and a standalone line) and an untracked mug
	const lines: Line[] = [
		{
			id: mockId(501),
			variant_id: mockId(7),
			quantity: '2',
			condition: null,
		},
		{
			id: mockId(502),
			variant_id: mockId(7),
			quantity: '12',
			condition: null,
		},
		{
			id: mockId(503),
			variant_id: mockId(99),
			quantity: '1',
			condition: null,
		},
	];

	// What the lots give: line 502 spans two lots at two costs
	const pieces: LotPiece[] = [
		{
			key: mockId(501),
			grn_item_id: mockId(31),
			variant_id: mockId(7),
			qty: 2,
			unit_cost_base: 40,
		},
		{
			key: mockId(502),
			grn_item_id: mockId(31),
			variant_id: mockId(7),
			qty: 8,
			unit_cost_base: 40,
		},
		{
			key: mockId(502),
			grn_item_id: mockId(32),
			variant_id: mockId(7),
			qty: 4,
			unit_cost_base: 48,
		},
	];

	let consumeLots: jest.SpiedFunction<typeof grnService.consumeLots>;
	let restoreLots: jest.SpiedFunction<typeof grnService.restoreLots>;
	let consumeForOrder: jest.SpiedFunction<
		typeof stockReservationService.consumeForOrder
	>;
	let restoreForOrder: jest.SpiedFunction<
		typeof stockReservationService.restoreForOrder
	>;

	beforeEach(() => {
		jest.restoreAllMocks();

		consumeLots = jest
			.spyOn(grnService, 'consumeLots')
			.mockResolvedValue(pieces);
		restoreLots = jest.spyOn(grnService, 'restoreLots').mockResolvedValue();
		consumeForOrder = jest
			.spyOn(stockReservationService, 'consumeForOrder')
			.mockResolvedValue();
		restoreForOrder = jest
			.spyOn(stockReservationService, 'restoreForOrder')
			.mockResolvedValue();
	});

	it('draws only the tracked lines from the pickup warehouse', async () => {
		const { manager } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);

		expect(consumeLots).toHaveBeenCalledWith(
			manager,
			WAREHOUSE_ID,
			[
				{ key: mockId(501), variant_id: mockId(7), quantity: 2 },
				{ key: mockId(502), variant_id: mockId(7), quantity: 12 },
			],
			{ allowShort: undefined },
		);
	});

	it('posts one sale per lot drawn, signed out, at the lot cost, naming the line', async () => {
		const { manager, ledger } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);

		expect(
			ledger.map((row) => [
				row.movement_type,
				row.source_id,
				row.grn_item_id,
				row.qty,
				row.unit_cost_base,
			]),
		).toEqual([
			[WarehouseMovementTypeEnum.SALE, mockId(501), mockId(31), -2, 40],
			[WarehouseMovementTypeEnum.SALE, mockId(502), mockId(31), -8, 40],
			[WarehouseMovementTypeEnum.SALE, mockId(502), mockId(32), -4, 48],
		]);
		expect(
			ledger.every(
				(row) =>
					row.source_type ===
					WarehouseMovementSourceEnum.SHIPPING_LINE,
			),
		).toBe(true);
	});

	// Per variant, summed across the two lines that carry it
	it('lowers the order reservation by what the lines say left', async () => {
		const { manager } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);

		expect(consumeForOrder).toHaveBeenCalledWith(
			manager,
			mockId(41),
			new Map([[mockId(7), 14]]),
		);
	});

	it('moves nothing for a delivery carrying only untracked goods', async () => {
		const { manager, ledger } = fakeManager(lines, []);

		await service.shipDelivery(manager, move);

		expect(consumeLots).not.toHaveBeenCalled();
		expect(consumeForOrder).not.toHaveBeenCalled();
		expect(ledger).toEqual([]);
	});

	it('leaves a return movement to receiveReturn', async () => {
		const { manager } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, {
			...move,
			scope: ShippingScopeEnum.RETURN,
		});

		expect(manager.getRepository).not.toHaveBeenCalled();
	});

	it('puts an undelivered parcel back into the lots it left, and the promise with it', async () => {
		const { manager, ledger } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);
		await service.returnDelivery(manager, move);

		const sales = ledger.filter(
			(row) => row.movement_type === WarehouseMovementTypeEnum.SALE,
		);
		const returns = ledger.filter(
			(row) =>
				row.movement_type === WarehouseMovementTypeEnum.SALE_RETURN,
		);

		// Each sale answered once, at its own lot and cost
		expect(
			returns.map((row) => [
				row.reversal_of_id,
				row.grn_item_id,
				row.qty,
				row.unit_cost_base,
			]),
		).toEqual(
			sales.map((sale) => [
				sale.id,
				sale.grn_item_id,
				-sale.qty,
				sale.unit_cost_base,
			]),
		);
		expect(restoreLots).toHaveBeenCalledWith(manager, [
			{ grn_item_id: mockId(31), qty: 2 },
			{ grn_item_id: mockId(31), qty: 8 },
			{ grn_item_id: mockId(32), qty: 4 },
		]);
		expect(restoreForOrder).toHaveBeenCalledWith(
			manager,
			mockId(41),
			new Map([[mockId(7), 14]]),
		);

		// The round trip nets to nothing per lot
		const net = new Map<EntityId | null, number>();

		for (const row of ledger) {
			net.set(
				row.grn_item_id,
				(net.get(row.grn_item_id) ?? 0) + Number(row.qty),
			);
		}

		expect([...net.values()]).toEqual([0, 0]);
	});

	it('reverses nothing twice when the return is announced again', async () => {
		const { manager, ledger } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);
		await service.returnDelivery(manager, move);
		await service.returnDelivery(manager, move);

		expect(
			ledger.filter(
				(row) =>
					row.movement_type === WarehouseMovementTypeEnum.SALE_RETURN,
			),
		).toHaveLength(3);
		expect(restoreLots).toHaveBeenCalledTimes(1);
		expect(restoreForOrder).toHaveBeenCalledTimes(1);
	});

	it('writes a lost parcel off on the lots it left, leaving lots and promise alone', async () => {
		const { manager, ledger } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);
		await service.loseDelivery(manager, move);

		const sales = ledger.filter(
			(row) => row.movement_type === WarehouseMovementTypeEnum.SALE,
		);
		const lost = ledger.filter(
			(row) => row.movement_type !== WarehouseMovementTypeEnum.SALE,
		);

		// Per sale: the sale reversed, then the same units written off, at its own lot and cost
		expect(
			lost.map((row) => [
				row.movement_type,
				row.reversal_of_id,
				row.source_id,
				row.grn_item_id,
				row.qty,
				row.unit_cost_base,
			]),
		).toEqual(
			sales.flatMap((sale) => [
				[
					WarehouseMovementTypeEnum.SALE_RETURN,
					sale.id,
					sale.source_id,
					sale.grn_item_id,
					-sale.qty,
					sale.unit_cost_base,
				],
				[
					WarehouseMovementTypeEnum.WRITE_OFF,
					null,
					sale.source_id,
					sale.grn_item_id,
					sale.qty,
					sale.unit_cost_base,
				],
			]),
		);
		expect(restoreLots).not.toHaveBeenCalled();
		expect(restoreForOrder).not.toHaveBeenCalled();

		// Each lot still holds what the ship left it: the loss adds nothing to the ledger sum
		const added = new Map<EntityId | null, number>();

		for (const row of lost) {
			added.set(
				row.grn_item_id,
				(added.get(row.grn_item_id) ?? 0) + Number(row.qty),
			);
		}

		expect([...added.values()]).toEqual([0, 0]);
	});

	it('writes nothing off twice when the loss is announced again', async () => {
		const { manager, ledger } = fakeManager(lines, [7]);

		await service.shipDelivery(manager, move);
		await service.loseDelivery(manager, move);
		await service.loseDelivery(manager, move);

		expect(
			ledger.filter(
				(row) =>
					row.movement_type === WarehouseMovementTypeEnum.WRITE_OFF,
			),
		).toHaveLength(3);
	});

	it('writes nothing off for a parcel that never shipped', async () => {
		const { manager, ledger } = fakeManager(lines, [7]);

		await service.loseDelivery(manager, move);

		expect(ledger).toEqual([]);
		expect(manager.save).not.toHaveBeenCalled();
	});
});
