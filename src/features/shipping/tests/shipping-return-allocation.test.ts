import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import OrderLineEntity from '@/features/order/order-line.entity';
import type ShippingEntity from '@/features/shipping/shipping.entity';
import {
	type ShippingScope,
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import type { ShippingQuery } from '@/features/shipping/shipping.repository';
import { ShippingService } from '@/features/shipping/shipping.service';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import { createMockRepository } from '@/tests/jest-service.setup';

type SumRow = { variant_id: number; quantity: string };

/**
 * What the shipping line sums answer, told apart by the parameters each query binds: the scope it
 * counts, and whether it is narrowed to `delivered` or leaves the released statuses out.
 */
type LinePools = {
	/** Lines of `delivered` deliveries - the return cap. */
	delivered: SumRow[];
	/** Lines of the order's other deliveries, any status - the delivery cap's allocation. */
	allocated: SumRow[];
	/** Lines of the order's live returns. */
	returning: SumRow[];
};

type BoundParameters = {
	scopes?: string[];
	statuses?: string[];
	excludeStatuses?: string[];
	excludeShippingId?: number;
};

function fakeManager(orderLines: unknown[], pools: LinePools) {
	const queries: BoundParameters[] = [];

	const createQueryBuilder = jest.fn(() => {
		const bound: BoundParameters = {};
		queries.push(bound);

		const bind = (_condition?: string, parameters?: object) => {
			Object.assign(bound, parameters ?? {});

			return builder;
		};

		const builder = {
			innerJoin: jest.fn(() => builder),
			where: jest.fn(bind),
			andWhere: jest.fn(bind),
			select: jest.fn(() => builder),
			addSelect: jest.fn(() => builder),
			groupBy: jest.fn(() => builder),
			getRawMany: jest.fn(async (): Promise<SumRow[]> => {
				if (bound.scopes?.includes(ShippingScopeEnum.RETURN)) {
					return pools.returning;
				}

				return bound.statuses ? pools.delivered : pools.allocated;
			}),
		};

		return builder;
	});

	const manager = {
		getRepository: jest.fn((target: unknown) => {
			if (target === OrderLineEntity) {
				return { find: jest.fn(async () => orderLines) };
			}

			if (target === ShippingLineEntity) {
				return { createQueryBuilder };
			}

			throw new Error('unexpected repository');
		}),
	};

	return {
		manager: manager as unknown as EntityManager,
		queries,
	};
}

describe('ShippingService - return allocation', () => {
	const mockShipping = createMockRepository<ShippingEntity, ShippingQuery>();

	const service = new ShippingService(
		mockShipping.repository as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
	);

	const assertLinesAllocatable = (
		manager: EntityManager,
		scope: ShippingScope,
		lines: { variant_id: number; quantity: number }[],
		excludeShippingId?: number,
	) =>
		(
			service as unknown as {
				assertLinesAllocatable(
					manager: EntityManager,
					orderId: number | null,
					scope: ShippingScope,
					lines: unknown,
					excludeShippingId?: number,
				): Promise<void>;
			}
		).assertLinesAllocatable(manager, 118, scope, lines, excludeShippingId);

	// One order line of 5 shirts; 3 arrived, 1 is already on its way back
	const orderLines = [{ id: 501, variant_id: 27, quantity: '5' }];
	const pools: LinePools = {
		delivered: [{ variant_id: 27, quantity: '3' }],
		allocated: [{ variant_id: 27, quantity: '5' }],
		returning: [{ variant_id: 27, quantity: '1' }],
	};

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it('lets a return carry what arrived and is not already coming back', async () => {
		const { manager } = fakeManager(orderLines, pools);

		await expect(
			assertLinesAllocatable(manager, ShippingScopeEnum.RETURN, [
				{ variant_id: 27, quantity: 2 },
			]),
		).resolves.toBeUndefined();
	});

	it('refuses a return past what arrived', async () => {
		const { manager } = fakeManager(orderLines, pools);

		await expect(
			assertLinesAllocatable(manager, ShippingScopeEnum.RETURN, [
				{ variant_id: 27, quantity: 3 },
			]),
		).rejects.toMatchObject({ statusCode: 409 });
	});

	// Ordered 5, but only 3 arrived - the order line is not the return's cap
	it('caps a return by the delivered goods, not the ordered ones', async () => {
		const { manager } = fakeManager(orderLines, {
			...pools,
			returning: [],
		});

		await expect(
			assertLinesAllocatable(manager, ShippingScopeEnum.RETURN, [
				{ variant_id: 27, quantity: 4 },
			]),
		).rejects.toMatchObject({ statusCode: 409 });
	});

	it('counts only delivered deliveries and live returns, leaving the edited movement out', async () => {
		const { manager, queries } = fakeManager(orderLines, pools);

		await assertLinesAllocatable(
			manager,
			ShippingScopeEnum.RETURN,
			[{ variant_id: 27, quantity: 1 }],
			64,
		);

		const returning = queries.find((query) =>
			query.scopes?.includes(ShippingScopeEnum.RETURN),
		);
		const delivered = queries.find((query) =>
			query.scopes?.includes(ShippingScopeEnum.DELIVERY),
		);

		expect(returning).toMatchObject({
			excludeStatuses: [
				ShippingStatusEnum.FAILED,
				ShippingStatusEnum.RETURNED,
				ShippingStatusEnum.CANCELED,
			],
			excludeShippingId: 64,
		});
		expect(delivered).toMatchObject({
			statuses: [ShippingStatusEnum.DELIVERED],
		});
		expect(delivered?.excludeShippingId).toBeUndefined();
	});

	it('answers 422 for a variant the order does not hold', async () => {
		const { manager } = fakeManager(orderLines, pools);

		await expect(
			assertLinesAllocatable(manager, ShippingScopeEnum.RETURN, [
				{ variant_id: 99, quantity: 1 },
			]),
		).rejects.toMatchObject({ statusCode: 422 });
	});

	// The other pool: a delivery is capped by the order line, never by what arrived
	it('caps a delivery by what the order holds less its other deliveries', async () => {
		const { manager } = fakeManager(orderLines, {
			...pools,
			allocated: [{ variant_id: 27, quantity: '4' }],
		});

		await expect(
			assertLinesAllocatable(manager, ShippingScopeEnum.DELIVERY, [
				{ variant_id: 27, quantity: 1 },
			]),
		).resolves.toBeUndefined();

		await expect(
			assertLinesAllocatable(manager, ShippingScopeEnum.DELIVERY, [
				{ variant_id: 27, quantity: 2 },
			]),
		).rejects.toMatchObject({ statusCode: 409 });
	});

	describe('getReturnableByVariant', () => {
		it('answers delivered less live returns, dropping what is fully claimed', async () => {
			const { manager } = fakeManager(orderLines, {
				...pools,
				delivered: [
					{ variant_id: 27, quantity: '3' },
					{ variant_id: 28, quantity: '1' },
				],
				returning: [
					{ variant_id: 27, quantity: '1' },
					{ variant_id: 28, quantity: '1' },
				],
			});

			const returnable = await service.getReturnableByVariant(
				118,
				manager,
			);

			expect([...returnable.entries()]).toEqual([[27, 2]]);
		});
	});
});
