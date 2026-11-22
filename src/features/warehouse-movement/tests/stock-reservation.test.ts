import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import OrderEntity, { OrderStatusEnum } from '@/features/order/order.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import StockReservationEntity from '@/features/warehouse-movement/stock-reservation.entity';
import { StockReservationService } from '@/features/warehouse-movement/stock-reservation.service';
import type { EntityId } from '@/shared/types/entity-id.type';
import { mockId } from '@/tests/mocks/uuid.mock';

type Variant = { id: EntityId; sku: string; allow_backorder: boolean };
type Reservation = {
	id: EntityId;
	order_id: EntityId;
	variant_id: EntityId;
	quantity: number;
};

/**
 * A transaction manager over an in-memory stock picture: tracked variants, open stock per
 * variant, and the reservation rows. The two sums the service reads are answered from the same
 * picture, so a test states the situation once and asserts on what the rows became.
 */
function fakeManager(state: {
	variants: Variant[];
	onHand: Record<number, number>;
	reservations: Reservation[];
	orderStatus?: string | null;
}) {
	let nextId = 1000;
	const queries: { sql: string; parameters: unknown[] }[] = [];

	const sumBuilder = (
		answer: () => { variant_id: EntityId; value: number }[],
		key: string,
	) => {
		const builder = {
			innerJoin: jest.fn(() => builder),
			select: jest.fn(() => builder),
			addSelect: jest.fn(() => builder),
			where: jest.fn(() => builder),
			andWhere: jest.fn(() => builder),
			groupBy: jest.fn(() => builder),
			getRawMany: jest.fn(async () =>
				answer().map((row) => ({
					variant_id: row.variant_id,
					[key]: String(row.value),
				})),
			),
		};

		return builder;
	};

	const reservationRepository = {
		find: jest.fn(
			async (options: {
				where: {
					order_id: EntityId;
					variant_id?: { value: EntityId[] };
				};
			}) =>
				state.reservations.filter(
					(row) =>
						row.order_id === options.where.order_id &&
						(!options.where.variant_id ||
							options.where.variant_id.value.includes(
								row.variant_id,
							)),
				),
		),
		delete: jest.fn(
			async (criteria: { order_id?: EntityId; id?: EntityId }) => {
				state.reservations = state.reservations.filter((row) =>
					criteria.id !== undefined
						? row.id !== criteria.id
						: row.order_id !== criteria.order_id,
				);
			},
		),
		insert: jest.fn(async (rows: Omit<Reservation, 'id'>[]) => {
			state.reservations.push(
				...rows.map((row) => ({ ...row, id: mockId(nextId++) })),
			);
		}),
		update: jest.fn(
			async (
				criteria: { id: EntityId },
				values: { quantity: number },
			) => {
				const row = state.reservations.find(
					(entry) => entry.id === criteria.id,
				);

				if (row) {
					row.quantity = values.quantity;
				}
			},
		),
		// `sumReserved`: every other order's reservation, per variant
		createQueryBuilder: jest.fn(() => {
			let excluded: EntityId | undefined;
			const builder = sumBuilder(() => {
				const totals = new Map<EntityId, number>();

				for (const row of state.reservations) {
					if (row.order_id !== excluded) {
						totals.set(
							row.variant_id,
							(totals.get(row.variant_id) ?? 0) + row.quantity,
						);
					}
				}

				return [...totals].map(([variant_id, value]) => ({
					variant_id,
					value,
				}));
			}, 'reserved');

			builder.andWhere.mockImplementation(((
				_condition: string,
				parameters?: { excludeOrderId?: EntityId },
			) => {
				excluded = parameters?.excludeOrderId ?? excluded;

				return builder;
			}) as never);

			return builder;
		}),
	};

	const manager = {
		getRepository: jest.fn((target: unknown) => {
			if (target === StockReservationEntity) {
				return reservationRepository;
			}

			if (target === ProductVariantEntity) {
				return {
					find: jest.fn(
						async (options: {
							where: { id: { value: EntityId[] } };
						}) =>
							state.variants.filter((variant) =>
								options.where.id.value.includes(variant.id),
							),
					),
				};
			}

			if (target === OrderEntity) {
				return {
					findOne: jest.fn(async () =>
						state.orderStatus === null
							? null
							: { id: mockId(1), status: state.orderStatus },
					),
				};
			}

			// `sumOnHand` reads the lots through the receipt item repository
			return {
				createQueryBuilder: jest.fn(() =>
					sumBuilder(
						() =>
							Object.entries(state.onHand).map(([id, value]) => ({
								variant_id: mockId(Number(id)),
								value,
							})),
						'on_hand',
					),
				),
			};
		}),
		query: jest.fn(async (sql: string, parameters: unknown[]) => {
			queries.push({ sql, parameters });
		}),
	};

	return { manager: manager as unknown as EntityManager, state, queries };
}

const quantities = (rows: Reservation[], orderId: EntityId) =>
	Object.fromEntries(
		rows
			.filter((row) => row.order_id === orderId)
			.map((row) => [row.variant_id, row.quantity]),
	);

describe('StockReservationService', () => {
	const service = new StockReservationService();

	// Variant 7: 10 on hand, 6 promised to order 2. Variant 8 sells on backorder. 99 is untracked.
	const picture = () => ({
		variants: [
			{ id: mockId(7), sku: 'TSH-M-RED', allow_backorder: false },
			{ id: mockId(8), sku: 'MUG-BLK', allow_backorder: true },
		],
		onHand: { 7: 10, 8: 0 } as Record<number, number>,
		reservations: [
			{
				id: mockId(1),
				order_id: mockId(2),
				variant_id: mockId(7),
				quantity: 6,
			},
		],
	});

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('reserveForOrder', () => {
		it('reserves what others leave available, dropping untracked goods', async () => {
			const { manager, state } = fakeManager(picture());

			await service.reserveForOrder(manager, mockId(1), [
				{ variant_id: mockId(7), quantity: 4 },
				{ variant_id: mockId(99), quantity: 3 },
			]);

			expect(quantities(state.reservations, mockId(1))).toEqual({
				[mockId(7)]: 4,
			});
		});

		it('refuses growing past what others leave available', async () => {
			const { manager, state } = fakeManager(picture());

			await expect(
				service.reserveForOrder(manager, mockId(1), [
					{ variant_id: mockId(7), quantity: 5 },
				]),
			).rejects.toMatchObject({ statusCode: 409 });
			// Nothing was rewritten
			expect(quantities(state.reservations, mockId(1))).toEqual({});
		});

		it('lets a backorder variant grow past its stock', async () => {
			const { manager, state } = fakeManager(picture());

			await service.reserveForOrder(manager, mockId(1), [
				{ variant_id: mockId(8), quantity: 5 },
			]);

			expect(quantities(state.reservations, mockId(1))).toEqual({
				[mockId(8)]: 5,
			});
		});

		// An edit asking for what the order already held is never refused, whatever stock did since
		it('restates to the same or less even when stock shrank below it', async () => {
			const start = picture();
			start.onHand[7] = 1;
			start.reservations.push({
				id: mockId(2),
				order_id: mockId(1),
				variant_id: mockId(7),
				quantity: 3,
			});
			const { manager, state } = fakeManager(start);

			await service.reserveForOrder(manager, mockId(1), [
				{ variant_id: mockId(7), quantity: 2 },
			]);

			expect(quantities(state.reservations, mockId(1))).toEqual({
				[mockId(7)]: 2,
			});
			expect(quantities(state.reservations, mockId(2))).toEqual({
				[mockId(7)]: 6,
			});
		});

		// Its own rows are left out of the count, so restating an order never competes with itself
		it('counts only the other orders against a growing line', async () => {
			const start = picture();
			start.reservations.push({
				id: mockId(2),
				order_id: mockId(1),
				variant_id: mockId(7),
				quantity: 3,
			});
			const { manager, state } = fakeManager(start);

			await service.reserveForOrder(manager, mockId(1), [
				{ variant_id: mockId(7), quantity: 4 },
			]);

			expect(quantities(state.reservations, mockId(1))).toEqual({
				[mockId(7)]: 4,
			});
		});

		it('drops a line the order no longer asks for', async () => {
			const start = picture();
			start.reservations.push({
				id: mockId(2),
				order_id: mockId(1),
				variant_id: mockId(7),
				quantity: 3,
			});
			const { manager, state } = fakeManager(start);

			await service.reserveForOrder(manager, mockId(1), []);

			expect(quantities(state.reservations, mockId(1))).toEqual({});
		});
	});

	describe('consumeForOrder', () => {
		it('lowers what is left and removes a row reaching zero', async () => {
			const start = picture();
			start.reservations.push(
				{
					id: mockId(2),
					order_id: mockId(1),
					variant_id: mockId(7),
					quantity: 3,
				},
				{
					id: mockId(3),
					order_id: mockId(1),
					variant_id: mockId(8),
					quantity: 2,
				},
			);
			const { manager, state } = fakeManager(start);

			await service.consumeForOrder(
				manager,
				mockId(1),
				new Map([
					[mockId(7), 1],
					[mockId(8), 2],
				]),
			);

			expect(quantities(state.reservations, mockId(1))).toEqual({
				[mockId(7)]: 2,
			});
		});

		// Shipped beyond its lines, or reserved with a gap: the row simply goes
		it('removes a row the shipment exceeds', async () => {
			const start = picture();
			start.reservations.push({
				id: mockId(2),
				order_id: mockId(1),
				variant_id: mockId(7),
				quantity: 1,
			});
			const { manager, state } = fakeManager(start);

			await service.consumeForOrder(
				manager,
				mockId(1),
				new Map([[mockId(7), 3]]),
			);

			expect(quantities(state.reservations, mockId(1))).toEqual({});
			expect(quantities(state.reservations, mockId(2))).toEqual({
				[mockId(7)]: 6,
			});
		});
	});

	describe('restoreForOrder', () => {
		it.each([OrderStatusEnum.PENDING, OrderStatusEnum.CONFIRMED])(
			'gives a %s order its units back, adding to what it holds',
			async (status) => {
				const { manager, queries } = fakeManager({
					...picture(),
					orderStatus: status,
				});

				await service.restoreForOrder(
					manager,
					mockId(1),
					new Map([
						[mockId(8), 2],
						[mockId(7), 1.5],
					]),
				);

				expect(queries.map((query) => query.parameters)).toEqual([
					[mockId(1), mockId(7), 1.5],
					[mockId(1), mockId(8), 2],
				]);
				expect(queries[0].sql).toContain(
					'ON CONFLICT (order_id, variant_id)',
				);
			},
		);

		it.each([OrderStatusEnum.COMPLETED, OrderStatusEnum.CANCELED])(
			'reserves nothing for a %s order',
			async (status) => {
				const { manager, queries } = fakeManager({
					...picture(),
					orderStatus: status,
				});

				await service.restoreForOrder(
					manager,
					mockId(1),
					new Map([[mockId(7), 1]]),
				);

				expect(queries).toEqual([]);
			},
		);
	});

	it('releaseForOrder drops every row of the order and no other', async () => {
		const start = picture();
		start.reservations.push({
			id: mockId(2),
			order_id: mockId(1),
			variant_id: mockId(7),
			quantity: 3,
		});
		const { manager, state } = fakeManager(start);

		await service.releaseForOrder(manager, mockId(1));

		expect(quantities(state.reservations, mockId(1))).toEqual({});
		expect(quantities(state.reservations, mockId(2))).toEqual({
			[mockId(7)]: 6,
		});
	});
});
