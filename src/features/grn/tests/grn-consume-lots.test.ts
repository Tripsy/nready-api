import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import type GrnEntity from '@/features/grn/grn.entity';
import type { GrnQuery } from '@/features/grn/grn.repository';
import { GrnService } from '@/features/grn/grn.service';
import GrnItemEntity from '@/features/grn/grn-item.entity';
import { createMockRepository } from '@/tests/jest-service.setup';

type Lot = {
	id: number;
	variant_id: number;
	qty_remaining: number;
	unit_cost_base: number;
	/** The receiving day of the lot's receipt - what FIFO orders by. */
	received_at: string;
};

/**
 * A transaction manager whose lot read answers `lots` - returned in id order, as the locking query
 * returns them - and which records the `qty_remaining` each lot is left with.
 */
function fakeManager(lots: Lot[]) {
	const updates: { id: number; qty_remaining: number }[] = [];

	const builder = {
		innerJoin: jest.fn(() => builder),
		select: jest.fn(() => builder),
		addSelect: jest.fn(() => builder),
		where: jest.fn(() => builder),
		andWhere: jest.fn(() => builder),
		orderBy: jest.fn(() => builder),
		setLock: jest.fn(() => builder),
		getRawAndEntities: jest.fn(async () => {
			const ordered = [...lots].sort((a, b) => a.id - b.id);

			return {
				entities: ordered.map((lot) => ({
					id: lot.id,
					variant_id: lot.variant_id,
					qty_remaining: String(lot.qty_remaining),
					unit_cost_base: String(lot.unit_cost_base),
				})),
				raw: ordered.map((lot) => ({
					item_id: lot.id,
					received_at: new Date(lot.received_at),
				})),
			};
		}),
	};

	const manager = {
		getRepository: jest.fn((target: unknown) => {
			if (target !== GrnItemEntity) {
				throw new Error('unexpected repository');
			}

			return { createQueryBuilder: jest.fn(() => builder) };
		}),
		update: jest.fn(
			async (
				_target: unknown,
				criteria: { id: number },
				values: { qty_remaining: number },
			) => {
				updates.push({
					id: criteria.id,
					qty_remaining: values.qty_remaining,
				});
			},
		),
	};

	return { manager: manager as unknown as EntityManager, updates, builder };
}

describe('GrnService - consumeLots', () => {
	const mockGrn = createMockRepository<GrnEntity, GrnQuery>();
	const service = new GrnService(
		mockGrn.repository as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
	);

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	// Lot 30 has the lowest id but arrived last; FIFO goes by the receiving day, not the id
	const lots: Lot[] = [
		{
			id: 30,
			variant_id: 7,
			qty_remaining: 10,
			unit_cost_base: 55,
			received_at: '2026-10-20',
		},
		{
			id: 31,
			variant_id: 7,
			qty_remaining: 10,
			unit_cost_base: 40,
			received_at: '2026-09-01',
		},
		{
			id: 32,
			variant_id: 7,
			qty_remaining: 10,
			unit_cost_base: 48,
			received_at: '2026-10-01',
		},
		{
			id: 33,
			variant_id: 9,
			qty_remaining: 4,
			unit_cost_base: 12,
			received_at: '2026-08-01',
		},
	];

	it('draws oldest first, spanning lots at their own costs', async () => {
		const { manager, updates } = fakeManager(lots);

		const pieces = await service.consumeLots(manager, 1, [
			{ key: 500, variant_id: 7, quantity: 14 },
		]);

		expect(pieces).toEqual([
			{
				key: 500,
				grn_item_id: 31,
				variant_id: 7,
				qty: 10,
				unit_cost_base: 40,
			},
			{
				key: 500,
				grn_item_id: 32,
				variant_id: 7,
				qty: 4,
				unit_cost_base: 48,
			},
		]);
		expect(updates).toEqual([
			{ id: 31, qty_remaining: 0 },
			{ id: 32, qty_remaining: 6 },
		]);
	});

	it('breaks a receiving-day tie by lot id', async () => {
		const { manager } = fakeManager([
			{
				id: 41,
				variant_id: 7,
				qty_remaining: 5,
				unit_cost_base: 20,
				received_at: '2026-10-01',
			},
			{
				id: 40,
				variant_id: 7,
				qty_remaining: 5,
				unit_cost_base: 30,
				received_at: '2026-10-01',
			},
		]);

		const pieces = await service.consumeLots(manager, 1, [
			{ key: 1, variant_id: 7, quantity: 6 },
		]);

		expect(pieces.map((piece) => [piece.grn_item_id, piece.qty])).toEqual([
			[40, 5],
			[41, 1],
		]);
	});

	// Two lines of one variant on a delivery: the second draws what the first left
	it('lets later demands draw from what earlier ones left', async () => {
		const { manager, updates } = fakeManager(lots);

		const pieces = await service.consumeLots(manager, 1, [
			{ key: 500, variant_id: 7, quantity: 8 },
			{ key: 501, variant_id: 7, quantity: 5 },
			{ key: 502, variant_id: 9, quantity: 4 },
		]);

		expect(
			pieces.map((piece) => [piece.key, piece.grn_item_id, piece.qty]),
		).toEqual([
			[500, 31, 8],
			[501, 31, 2],
			[501, 32, 3],
			[502, 33, 4],
		]);
		// Written in FIFO order; the row locks were taken in id order by the read already
		expect(updates).toHaveLength(3);
		expect(updates).toEqual(
			expect.arrayContaining([
				{ id: 31, qty_remaining: 0 },
				{ id: 32, qty_remaining: 7 },
				{ id: 33, qty_remaining: 0 },
			]),
		);
	});

	it('refuses a shortage with 409 and writes nothing', async () => {
		const { manager, updates } = fakeManager(lots);

		await expect(
			service.consumeLots(manager, 1, [
				{ key: 500, variant_id: 7, quantity: 31 },
			]),
		).rejects.toMatchObject({ statusCode: 409 });
		expect(updates).toEqual([]);
	});

	// The backfill path: goods that already left are drawn as far as the lots go
	it('takes what there is when allowed short', async () => {
		const { manager, updates } = fakeManager(lots);

		const pieces = await service.consumeLots(
			manager,
			1,
			[{ key: 502, variant_id: 9, quantity: 6 }],
			{ allowShort: true },
		);

		expect(pieces).toEqual([
			{
				key: 502,
				grn_item_id: 33,
				variant_id: 9,
				qty: 4,
				unit_cost_base: 12,
			},
		]);
		expect(updates).toEqual([{ id: 33, qty_remaining: 0 }]);
	});

	it('keeps fractional quantities to the cent', async () => {
		const { manager, updates } = fakeManager([
			{
				id: 50,
				variant_id: 7,
				qty_remaining: 1.1,
				unit_cost_base: 9,
				received_at: '2026-09-01',
			},
			{
				id: 51,
				variant_id: 7,
				qty_remaining: 2.2,
				unit_cost_base: 9,
				received_at: '2026-10-01',
			},
		]);

		const pieces = await service.consumeLots(manager, 1, [
			{ key: 1, variant_id: 7, quantity: 3.3 },
		]);

		expect(pieces.map((piece) => piece.qty)).toEqual([1.1, 2.2]);
		expect(updates).toEqual([
			{ id: 50, qty_remaining: 0 },
			{ id: 51, qty_remaining: 0 },
		]);
	});

	it('reads nothing when nothing is asked', async () => {
		const { manager } = fakeManager(lots);

		await expect(
			service.consumeLots(manager, 1, [
				{ key: 1, variant_id: 7, quantity: 0 },
			]),
		).resolves.toEqual([]);
		expect(manager.getRepository).not.toHaveBeenCalled();
	});
});
