import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { grnService } from '@/features/grn/grn.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { ShippingScopeEnum } from '@/features/shipping/shipping.entity';
import type { ShippingStockMove } from '@/features/shipping/shipping.hooks';
import ShippingLineEntity, {
	type ShippingLineCondition,
	ShippingLineConditionEnum,
} from '@/features/shipping/shipping-line.entity';
import WarehouseMovementEntity, {
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import type { WarehouseMovementQuery } from '@/features/warehouse-movement/warehouse-movement.repository';
import { WarehouseMovementService } from '@/features/warehouse-movement/warehouse-movement.service';
import type { EntityId } from '@/shared/types/entity-id.type';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

const WAREHOUSE_ID = mockId(2);
const DELIVERY_LINE_ID = mockId(800);
const RETURN_LINE_ID = mockId(900);

type Sale = {
	id: EntityId;
	grn_item_id: EntityId;
	variant_id: EntityId;
	qty: number;
	unit_cost_base: number;
};

type Ledger = {
	/** The order's `sale` rows at the destination, newest first - as the query orders them. */
	sales: Sale[];
	/** Reversals of those sales: undelivered parcels put back whole. */
	undelivered?: { reversal_of_id: EntityId; qty: number }[];
	/** `sale_return` rows earlier returns of the order already posted. */
	returned?: { grn_item_id: EntityId; qty: number }[];
};

/**
 * A transaction manager answering the reads `receiveReturn` makes: the movement's lines, which of
 * their variants track stock, the order's line ids per scope, and the ledger.
 */
function fakeManager(
	lines: {
		id: EntityId;
		variant_id: EntityId;
		quantity: string;
		condition: ShippingLineCondition | null;
	}[],
	ledger: Ledger,
	tracked: number[] = [27],
) {
	const saved: WarehouseMovementEntity[] = [];

	const lineIds = jest.fn(() => {
		const bound: { scope?: string } = {};
		const bind = (_condition?: string, parameters?: object) => {
			Object.assign(bound, parameters ?? {});

			return builder;
		};
		const builder = {
			withDeleted: jest.fn(() => builder),
			innerJoin: jest.fn(() => builder),
			where: jest.fn(bind),
			andWhere: jest.fn(bind),
			select: jest.fn(() => builder),
			getRawMany: jest.fn(async () =>
				bound.scope === ShippingScopeEnum.DELIVERY
					? [{ id: DELIVERY_LINE_ID }]
					: [{ id: RETURN_LINE_ID }],
			),
		};

		return builder;
	});

	const movements = jest.fn(
		async (options: { where: Record<string, unknown> }) => {
			if (options.where.reversal_of_id !== undefined) {
				return options.where.movement_type ===
					WarehouseMovementTypeEnum.SALE_RETURN
					? (ledger.returned ?? [])
					: (ledger.undelivered ?? []);
			}

			return ledger.sales;
		},
	);

	const manager = {
		getRepository: jest.fn((target: unknown) => {
			if (target === ShippingLineEntity) {
				return {
					find: jest.fn(async () => lines),
					createQueryBuilder: lineIds,
				};
			}

			if (target === ProductVariantEntity) {
				return {
					find: jest.fn(async () =>
						tracked.map((id) => ({ id: mockId(id) })),
					),
				};
			}

			if (target === WarehouseMovementEntity) {
				return { find: movements };
			}

			throw new Error('unexpected repository');
		}),
		create: jest.fn((_target: unknown, values: object) => values),
		save: jest.fn(async (rows: WarehouseMovementEntity[]) => {
			saved.push(...rows);

			return rows;
		}),
	};

	return { manager: manager as unknown as EntityManager, saved };
}

const move: ShippingStockMove = {
	shipping_id: mockId(64),
	order_id: mockId(118),
	scope: ShippingScopeEnum.RETURN,
	pickup_warehouse_id: null,
	destination_warehouse_id: WAREHOUSE_ID,
};

// Two lots sold from for the order, the newer one first: 2 from lot 11, 2 from lot 10
const sales: Sale[] = [
	{
		id: mockId(71),
		grn_item_id: mockId(11),
		variant_id: mockId(27),
		qty: -2,
		unit_cost_base: 60,
	},
	{
		id: mockId(70),
		grn_item_id: mockId(10),
		variant_id: mockId(27),
		qty: -2,
		unit_cost_base: 50,
	},
];

const returnLine = (
	quantity: string,
	condition: ShippingLineCondition | null,
) => ({
	id: RETURN_LINE_ID,
	variant_id: mockId(27),
	quantity: quantity,
	condition: condition,
});

describe('WarehouseMovementService - receiveReturn', () => {
	const mockMovement = createMockRepository<
		WarehouseMovementEntity,
		WarehouseMovementQuery
	>();
	const service = new WarehouseMovementService(
		mockMovement.repository as never,
	);

	let restoreLots: jest.SpiedFunction<typeof grnService.restoreLots>;

	beforeEach(() => {
		jest.restoreAllMocks();

		restoreLots = jest.spyOn(grnService, 'restoreLots').mockResolvedValue();
	});

	it('puts resellable goods back into the lots sold from, newest first, at their cost', async () => {
		const { manager, saved } = fakeManager(
			[returnLine('3', ShippingLineConditionEnum.RESELLABLE)],
			{ sales },
		);

		await service.receiveReturn(manager, move);

		expect(saved).toEqual([
			expect.objectContaining({
				movement_type: WarehouseMovementTypeEnum.SALE_RETURN,
				grn_item_id: mockId(11),
				qty: 2,
				unit_cost_base: 60,
				warehouse_id: WAREHOUSE_ID,
				source_id: RETURN_LINE_ID,
				reversal_of_id: null,
			}),
			expect.objectContaining({
				movement_type: WarehouseMovementTypeEnum.SALE_RETURN,
				grn_item_id: mockId(10),
				qty: 1,
				unit_cost_base: 50,
			}),
		]);
		expect(restoreLots).toHaveBeenCalledWith(manager, [
			{ grn_item_id: mockId(11), qty: 2 },
			{ grn_item_id: mockId(10), qty: 1 },
		]);
	});

	it('books damaged goods in and straight out again, restoring no lot', async () => {
		const { manager, saved } = fakeManager(
			[returnLine('1', ShippingLineConditionEnum.DAMAGED)],
			{ sales },
		);

		await service.receiveReturn(manager, move);

		expect(saved).toEqual([
			expect.objectContaining({
				movement_type: WarehouseMovementTypeEnum.SALE_RETURN,
				grn_item_id: mockId(11),
				qty: 1,
			}),
			expect.objectContaining({
				movement_type: WarehouseMovementTypeEnum.WRITE_OFF,
				grn_item_id: mockId(11),
				qty: -1,
			}),
		]);
		expect(restoreLots).toHaveBeenCalledWith(manager, []);
	});

	// Lot 11: 2 sold, 1 came back undelivered. Lot 10: 2 sold, 1 returned already. 2 left in all
	it('leaves out what undelivered parcels and earlier returns already put back', async () => {
		const ledger: Ledger = {
			sales,
			undelivered: [{ reversal_of_id: mockId(71), qty: 1 }],
			returned: [{ grn_item_id: mockId(10), qty: 1 }],
		};

		const { manager: fits, saved } = fakeManager(
			[returnLine('2', ShippingLineConditionEnum.RESELLABLE)],
			ledger,
		);

		await service.receiveReturn(fits, move);

		expect(saved.map((row) => [row.grn_item_id, row.qty])).toEqual([
			[mockId(11), 1],
			[mockId(10), 1],
		]);

		const { manager: over } = fakeManager(
			[returnLine('3', ShippingLineConditionEnum.RESELLABLE)],
			ledger,
		);

		await expect(service.receiveReturn(over, move)).rejects.toMatchObject({
			statusCode: 409,
		});
	});

	it('refuses goods the destination never sold from', async () => {
		const { manager, saved } = fakeManager(
			[returnLine('1', ShippingLineConditionEnum.RESELLABLE)],
			{ sales: [] },
		);

		await expect(
			service.receiveReturn(manager, move),
		).rejects.toMatchObject({ statusCode: 409 });
		expect(saved).toEqual([]);
		expect(restoreLots).not.toHaveBeenCalled();
	});

	it('posts nothing for untracked goods', async () => {
		const { manager, saved } = fakeManager(
			[returnLine('1', ShippingLineConditionEnum.RESELLABLE)],
			{ sales },
			[],
		);

		await service.receiveReturn(manager, move);

		expect(saved).toEqual([]);
		expect(restoreLots).not.toHaveBeenCalled();
	});

	it('ignores a movement that is not a return', async () => {
		const { manager } = fakeManager([], { sales });

		await service.receiveReturn(manager, {
			...move,
			scope: ShippingScopeEnum.DELIVERY,
		});

		expect(manager.getRepository).not.toHaveBeenCalled();
	});
});
