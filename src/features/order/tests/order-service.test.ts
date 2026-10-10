import { expect, jest } from '@jest/globals';
import { clientAddressService } from '@/features/client-address/client-address.service';
import OrderEntity, {
	type OrderBillingAddress,
	type OrderStatus,
	OrderStatusEnum,
} from '@/features/order/order.entity';
import { registerOrderInvoicedResolver } from '@/features/order/order.hooks';
import { orderService } from '@/features/order/order.service';
import type { OrderValidator } from '@/features/order/order.validator';
import { cacheProvider } from '@/providers/cache.provider';
import type { ValidatorOutput } from '@/shared/types/mock.type';
import { setupTransactionMock } from '@/tests/jest-service.setup';

type OrderUpdateData = ValidatorOutput<OrderValidator, 'update'>;

const orderWith = (overrides: Partial<OrderEntity>): OrderEntity =>
	({
		id: 1,
		client_id: 1,
		status: OrderStatusEnum.PENDING,
		discount: null,
		billing_address: null,
		notes: null,
		...overrides,
	}) as unknown as OrderEntity;

describe('OrderService.updateData - billing address', () => {
	/*
	 * Keys in the order `jsonb` hands them back - shortest first - which is not the order
	 * `toBillingAddress` builds them in. The values are the payload's below.
	 */
	const stored: OrderBillingAddress = {
		notes: null,
		details: 'Str. Lunga 1',
		postal_code: '010101',
		country_code: 'RO',
		address_city: 'Bucharest',
		address_region: 'Bucharest',
		address_country: 'Romania',
	};

	const payload = {
		details: 'Str. Lunga 1',
		postal_code: '010101',
		address_city: 'Bucharest',
		address_region: 'Bucharest',
		country_code: 'RO',
		notes: null,
	};

	beforeEach(() => {
		jest.restoreAllMocks();

		// An issued document froze the billing details
		registerOrderInvoicedResolver(async () => true);

		jest.spyOn(clientAddressService, 'resolveCountry').mockResolvedValue({
			code: 'RO',
			name: 'Romania',
		});
		jest.spyOn(cacheProvider, 'deleteByPattern').mockResolvedValue();
	});

	afterAll(() => {
		registerOrderInvoicedResolver(null);
	});

	// The dashboard form resends the address with every save, an edit of `notes` included
	it('saves an invoiced order when the address restated is the one stored', async () => {
		const { manager } = setupTransactionMock();

		manager.save.mockImplementation(async (entity: unknown) => entity);

		const saved = await orderService.updateData(
			orderWith({ billing_address: stored }),
			{
				billing_address: payload,
				notes: 'Call before delivery',
			} as unknown as OrderUpdateData,
			false,
		);

		expect(saved.notes).toBe('Call before delivery');
		expect(manager.save).toHaveBeenCalledTimes(1);
	});

	it('refuses a changed address on an invoiced order', async () => {
		const { manager } = setupTransactionMock();

		await expect(
			orderService.updateData(
				orderWith({ billing_address: stored }),
				{
					billing_address: { ...payload, postal_code: '020202' },
				} as unknown as OrderUpdateData,
				false,
			),
		).rejects.toMatchObject({ statusCode: 409 });

		expect(manager.save).not.toHaveBeenCalled();
	});
});

describe('OrderService.updateStatus', () => {
	/**
	 * A transaction whose locked read of the order finds it in `current` - whatever the entity the
	 * caller holds says.
	 */
	const lockedAt = (current: OrderStatus) => {
		const findOneOrFail = jest.fn(async (..._args: unknown[]) =>
			orderWith({ status: current }),
		);
		const { manager } = setupTransactionMock({ findOneOrFail });

		manager.save.mockImplementation(async (entity: unknown) => entity);

		return { manager, findOneOrFail };
	};

	beforeEach(() => {
		jest.restoreAllMocks();
		jest.spyOn(cacheProvider, 'deleteByPattern').mockResolvedValue();
	});

	// A cancel committed after the caller loaded the order: confirming must not write over it
	it('refuses to confirm an order canceled since it was loaded', async () => {
		const { manager, findOneOrFail } = lockedAt(OrderStatusEnum.CANCELED);
		const entry = orderWith({ status: OrderStatusEnum.PENDING });

		await expect(
			orderService.updateStatus(entry, OrderStatusEnum.CONFIRMED),
		).rejects.toMatchObject({ statusCode: 409 });

		expect(findOneOrFail).toHaveBeenCalledWith({
			where: { id: 1 },
			lock: { mode: 'pessimistic_write' },
		});
		expect(manager.save).not.toHaveBeenCalled();
	});

	// Settlement moves one entity pending -> confirmed -> completed, checking each from the last
	it('confirms from the locked status and brings the entry up to date', async () => {
		const { manager } = lockedAt(OrderStatusEnum.PENDING);
		const entry = orderWith({ status: OrderStatusEnum.PENDING });

		const saved = await orderService.updateStatus(
			entry,
			OrderStatusEnum.CONFIRMED,
		);

		expect(saved.status).toBe(OrderStatusEnum.CONFIRMED);
		expect(entry.status).toBe(OrderStatusEnum.CONFIRMED);
		expect(manager.save).toHaveBeenCalledTimes(1);
	});
});
