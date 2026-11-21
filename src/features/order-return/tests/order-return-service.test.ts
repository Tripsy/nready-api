import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ClientEntity from '@/features/client/client.entity';
import type { DocumentSeriesService } from '@/features/document-series/document-series.service';
import InvoiceEntity from '@/features/invoice/invoice.entity';
import { getInvoiceLineEntityMock } from '@/features/invoice/invoice.mock';
import type { InvoiceService } from '@/features/invoice/invoice.service';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import InvoiceSourceEntity from '@/features/invoice/invoice-source.entity';
import OrderEntity, { OrderStatusEnum } from '@/features/order/order.entity';
import type { OrderService } from '@/features/order/order.service';
import OrderLineEntity from '@/features/order/order-line.entity';
import OrderReturnEntity, {
	OrderReturnStatusEnum,
} from '@/features/order-return/order-return.entity';
import {
	getOrderReturnEntityMock,
	orderReturnOutputPayloads,
} from '@/features/order-return/order-return.mock';
import type { OrderReturnQuery } from '@/features/order-return/order-return.repository';
import { OrderReturnService } from '@/features/order-return/order-return.service';
import {
	OrderReturnEmailEventEnum,
	type OrderReturnEmailService,
} from '@/features/order-return/order-return-email.service';
import OrderReturnLineEntity from '@/features/order-return/order-return-line.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ShippingEntity, {
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import type { ShippingService } from '@/features/shipping/shipping.service';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import { cacheProvider } from '@/providers/cache.provider';
import type { EntityId } from '@/shared/types/entity-id.type';
import { createMockRepository } from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

/** A TypeORM query builder stand-in: every filter chains, the terminals are configured per test. */
function fakeQueryBuilder() {
	const builder = {
		select: jest.fn(() => builder),
		addSelect: jest.fn(() => builder),
		where: jest.fn(() => builder),
		andWhere: jest.fn(() => builder),
		innerJoin: jest.fn(() => builder),
		groupBy: jest.fn(() => builder),
		addGroupBy: jest.fn(() => builder),
		getRawMany: jest.fn<() => Promise<unknown[]>>(async () => []),
		getRawOne: jest.fn<() => Promise<unknown>>(async () => null),
	};

	return builder;
}

/** What the service reads off `getRepository(Entity)` - only the calls it makes. */
function fakeRepository() {
	const builder = fakeQueryBuilder();

	return {
		builder: builder,
		find: jest.fn<(options?: unknown) => Promise<unknown[]>>(
			async () => [],
		),
		findOne: jest.fn<(options?: unknown) => Promise<unknown>>(
			async () => null,
		),
		delete: jest.fn<(criteria?: unknown) => Promise<unknown>>(
			async () => ({}),
		),
		createQueryBuilder: jest.fn(() => builder),
	};
}

type FakeRepository = ReturnType<typeof fakeRepository>;

/** Lets the fire-and-forget email chain (`runInBackground`) run to its end. */
async function flushBackground(): Promise<void> {
	for (let step = 0; step < 20; step++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

describe('OrderReturnService', () => {
	const mockOrderReturn = createMockRepository<
		OrderReturnEntity,
		OrderReturnQuery
	>();

	const documentSeries = {
		allocate:
			jest.fn<
				(
					manager: unknown,
					type: string,
				) => Promise<{ code: string; number: number }>
			>(),
	};
	const orders = {
		findOwnById:
			jest.fn<(id: EntityId, userId: EntityId) => Promise<unknown>>(),
	};
	const shipping = {
		getReturnableByVariant: jest.fn<() => Promise<Map<EntityId, number>>>(),
		prepareCreate: jest.fn<(input: unknown) => Promise<unknown>>(),
		createWithin:
			jest.fn<
				(manager: unknown, input: unknown) => Promise<{ id: EntityId }>
			>(),
		findById: jest.fn<() => Promise<unknown>>(),
		updateStatus:
			jest.fn<(movement: unknown, status: string) => Promise<unknown>>(),
	};
	const invoices = {
		findIdsBySource: jest.fn<() => Promise<EntityId[]>>(),
		getLines: jest.fn<(id: EntityId) => Promise<unknown[]>>(),
		getReversedPerLine:
			jest.fn<
				(
					id: EntityId,
				) => Promise<Map<EntityId, { quantity: number; net: number }>>
			>(),
		findById: jest.fn<(id: EntityId) => Promise<unknown>>(),
		createReversal:
			jest.fn<
				(parent: unknown, data: unknown) => Promise<{ id: EntityId }>
			>(),
	};
	const emails = {
		send: jest.fn<
			(event: string, entry: unknown, recipient: unknown) => Promise<void>
		>(),
	};

	const service = new OrderReturnService(
		mockOrderReturn.repository as never,
		documentSeries as unknown as DocumentSeriesService,
		orders as unknown as OrderService,
		shipping as unknown as ShippingService,
		invoices as unknown as InvoiceService,
		emails as unknown as OrderReturnEmailService,
	);

	let repositories: Map<unknown, FakeRepository>;
	let manager: {
		getRepository: (target: unknown) => FakeRepository;
		save: jest.Mock<(entity: unknown) => Promise<unknown>>;
		create: jest.Mock<(target: unknown, values: unknown) => unknown>;
	};

	/** The fake behind `getRepository(target)`, from the data source or a transaction alike. */
	const repo = (target: unknown): FakeRepository => {
		const existing = repositories.get(target);

		if (existing) {
			return existing;
		}

		const created = fakeRepository();
		repositories.set(target, created);

		return created;
	};

	beforeEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();

		repositories = new Map();

		manager = {
			getRepository: repo,
			save: jest.fn(async (entity: unknown) => entity),
			create: jest.fn((_target: unknown, values: unknown) => values),
		};

		jest.spyOn(dataSource, 'getRepository').mockImplementation(((
			target: unknown,
		) => repo(target)) as never);

		jest.spyOn(dataSource, 'transaction').mockImplementation((async (
			callback: (manager: EntityManager) => Promise<unknown>,
		) => callback(manager as unknown as EntityManager)) as never);

		jest.spyOn(cacheProvider, 'deleteByPattern').mockResolvedValue(
			undefined as never,
		);

		emails.send.mockResolvedValue();
		invoices.getReversedPerLine.mockResolvedValue(new Map());
		invoices.findById.mockImplementation(async (id: EntityId) => ({ id }));
	});

	/** The row lock reads the return back as stored; `entry` is what the caller last read. */
	function lockReturns(entry: OrderReturnEntity): void {
		repo(OrderReturnEntity).findOne.mockResolvedValue({ ...entry });
	}

	describe('create', () => {
		const data = orderReturnOutputPayloads.create;

		beforeEach(() => {
			repo(OrderEntity).findOne.mockResolvedValue({
				id: data.order_id,
				status: OrderStatusEnum.CONFIRMED,
			});
			repo(OrderLineEntity).find.mockResolvedValue([
				{ variant_id: mockId(27), product_id: mockId(12) },
			]);
			shipping.getReturnableByVariant.mockResolvedValue(
				new Map([[mockId(27), 2]]),
			);
			documentSeries.allocate.mockResolvedValue({
				code: 'RMA',
				number: 8,
			});
		});

		it('refuses an order that is not accepted', async () => {
			repo(OrderEntity).findOne.mockResolvedValue({
				id: data.order_id,
				status: OrderStatusEnum.PENDING,
			});

			await expect(
				service.create(data, { userId: null, enforceWindow: false }),
			).rejects.toMatchObject({ statusCode: 409 });

			expect(documentSeries.allocate).not.toHaveBeenCalled();
		});

		it('holds the storefront to the window after the last delivery', async () => {
			repo(ShippingEntity).builder.getRawOne.mockResolvedValue({
				delivered_at: new Date('2020-01-01T00:00:00Z'),
			});

			await expect(
				service.create(data, {
					userId: mockId(42),
					enforceWindow: true,
				}),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('lets the back office past the window', async () => {
			repo(ShippingEntity).builder.getRawOne.mockResolvedValue({
				delivered_at: new Date('2020-01-01T00:00:00Z'),
			});

			await service.create(data, { userId: null, enforceWindow: false });

			expect(documentSeries.allocate).toHaveBeenCalled();
		});

		it('answers 422 for a variant the order does not hold', async () => {
			repo(OrderLineEntity).find.mockResolvedValue([
				{ variant_id: mockId(99), product_id: mockId(40) },
			]);

			await expect(
				service.create(data, { userId: null, enforceWindow: false }),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('takes off what pending requests already claim', async () => {
			// 2 delivered, 1 claimed by another return still waiting - 1 left, 2 asked
			repo(OrderReturnLineEntity).builder.getRawMany.mockResolvedValue([
				{ variant_id: mockId(27), quantity: '1' },
			]);

			await expect(
				service.create(
					{
						...data,
						lines: [{ variant_id: mockId(27), quantity: 2 }],
					},
					{ userId: null, enforceWindow: false },
				),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('writes the request numbered from the series, lines keyed on the sold product', async () => {
			const entry = await service.create(data, {
				userId: mockId(42),
				enforceWindow: true,
			});

			expect(documentSeries.allocate).toHaveBeenCalledWith(
				manager,
				'order_return',
			);
			expect(entry).toMatchObject({
				ref_code: 'RMA',
				ref_number: 8,
				status: OrderReturnStatusEnum.REQUESTED,
				user_id: mockId(42),
				order_id: data.order_id,
			});
			expect(manager.save).toHaveBeenLastCalledWith([
				expect.objectContaining({
					variant_id: mockId(27),
					product_id: mockId(12),
					quantity: 1,
				}),
			]);
		});
	});

	describe('updateData', () => {
		it('refuses lines once the return is decided', async () => {
			await expect(
				service.updateData(
					getOrderReturnEntityMock({
						status: OrderReturnStatusEnum.APPROVED,
					}),
					{
						...orderReturnOutputPayloads.update,
						lines: [{ variant_id: mockId(27), quantity: 1 }],
					},
				),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('refuses to change refund_shipping once the refund is drafted', async () => {
			const entry = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.RECEIVED,
				reversal_invoice_ids: [mockId(212)],
			});

			lockReturns(entry);

			await expect(
				service.updateData(entry, {
					...orderReturnOutputPayloads.update,
					refund_shipping: true,
				}),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('refuses refund_shipping on a rejected return', async () => {
			const entry = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.REJECTED,
			});

			lockReturns(entry);

			await expect(
				service.updateData(entry, {
					...orderReturnOutputPayloads.update,
					refund_shipping: true,
				}),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('takes refund_shipping while the refund is ahead', async () => {
			const entry = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.RECEIVED,
			});

			lockReturns(entry);

			const saved = await service.updateData(entry, {
				...orderReturnOutputPayloads.update,
				refund_shipping: true,
			});

			expect(saved.refund_shipping).toBe(true);
		});

		// Re-sending the value the return already holds changes nothing, so it is no refusal
		it('lets an unchanged refund_shipping through after the draft', async () => {
			const entry = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.CLOSED,
				reversal_invoice_ids: [mockId(212)],
				refund_shipping: true,
			});

			lockReturns(entry);

			await expect(
				service.updateData(entry, {
					...orderReturnOutputPayloads.update,
					refund_shipping: true,
				}),
			).resolves.toBeDefined();
		});
	});

	describe('approve', () => {
		const entry = getOrderReturnEntityMock();

		beforeEach(() => {
			lockReturns(entry);

			repo(OrderReturnLineEntity).find.mockResolvedValue([
				{
					order_return_id: entry.id,
					variant_id: mockId(27),
					product_id: mockId(12),
					quantity: '1',
				},
				{
					order_return_id: entry.id,
					variant_id: mockId(28),
					product_id: mockId(12),
					quantity: '2',
				},
			]);
			repo(ShippingEntity).findOne.mockResolvedValue({
				id: mockId(50),
				destination_client_address_id: mockId(5),
				currency: 'RON',
			});
			// Warehouse 1 sent the shirt, warehouse 2 both shirts' colors - 2 sent most of what returns
			repo(ShippingLineEntity).builder.getRawMany.mockResolvedValue([
				{
					warehouse_id: mockId(1),
					variant_id: mockId(27),
					quantity: '1',
				},
				{
					warehouse_id: mockId(2),
					variant_id: mockId(27),
					quantity: '1',
				},
				{
					warehouse_id: mockId(2),
					variant_id: mockId(28),
					quantity: '2',
				},
			]);
			repo(ProductVariantEntity).find.mockResolvedValue([
				{ id: mockId(27) },
				{ id: mockId(28) },
			]);

			shipping.prepareCreate.mockImplementation(async (input) => input);
			shipping.createWithin.mockResolvedValue({ id: mockId(64) });
			mockOrderReturn.query.firstOrFail.mockResolvedValue({
				...entry,
				order: {
					id: mockId(118),
					ref_code: 'ORD',
					ref_number: 118,
					client_id: mockId(9),
				},
			} as never);
		});

		it('sends the goods back to the site that sent most of them, from the delivery address', async () => {
			await service.approve(entry, {
				...orderReturnOutputPayloads.approve,
				refund_shipping: undefined,
			});

			expect(shipping.prepareCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					scope: 'return',
					order_id: entry.order_id,
					destination_warehouse_id: mockId(2),
					pickup_client_address_id: mockId(5),
					currency: 'RON',
					price: 0,
					lines: [
						expect.objectContaining({
							variant_id: mockId(27),
							quantity: 1,
						}),
						expect.objectContaining({
							variant_id: mockId(28),
							quantity: 2,
						}),
					],
				}),
			);
		});

		it('moves the request to approved with its movement and the fee decision', async () => {
			const saved = await service.approve(
				entry,
				orderReturnOutputPayloads.approve,
			);

			expect(shipping.createWithin).toHaveBeenCalledWith(
				manager,
				expect.anything(),
			);
			expect(saved).toMatchObject({
				status: OrderReturnStatusEnum.APPROVED,
				shipping_id: mockId(64),
				refund_shipping: true,
				response: 'Approved - the courier will collect it',
			});
			expect(saved.decided_at).toBeInstanceOf(Date);
		});

		it('refuses a stated warehouse that did not send a stocked line', async () => {
			await expect(
				service.approve(entry, {
					...orderReturnOutputPayloads.approve,
					destination_warehouse_id: mockId(1),
				}),
			).rejects.toMatchObject({ statusCode: 409 });

			expect(shipping.createWithin).not.toHaveBeenCalled();
		});

		// Untracked goods have no lot to re-enter, so they may come back anywhere
		it('lets untracked goods back into any stated warehouse', async () => {
			repo(ProductVariantEntity).find.mockImplementation(
				async (options) =>
					(options as { where: { track_stock?: boolean } }).where
						.track_stock
						? []
						: [
								{
									id: mockId(27),
									sku: 'OXF-M',
									product_id: mockId(12),
								},
							],
			);

			await service.approve(entry, {
				...orderReturnOutputPayloads.approve,
				destination_warehouse_id: mockId(1),
			});

			expect(shipping.createWithin).toHaveBeenCalled();
		});

		it('emails the buyer once approved', async () => {
			repo(ClientEntity).findOne.mockResolvedValue({
				id: mockId(9),
				contact_email: 'billing@example.com',
				user: {
					id: mockId(42),
					name: 'Ana',
					email: 'ana@example.com',
					language: 'ro',
				},
			});

			await service.approve(entry, orderReturnOutputPayloads.approve);
			await flushBackground();

			expect(emails.send).toHaveBeenCalledWith(
				OrderReturnEmailEventEnum.APPROVED,
				expect.objectContaining({ id: entry.id }),
				{ name: 'Ana', address: 'ana@example.com', language: 'ro' },
			);
		});
	});

	describe('updateStatus', () => {
		it('refuses to cancel once the goods are on their way back', async () => {
			const entry = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.APPROVED,
				shipping_id: mockId(64),
			});

			shipping.findById.mockResolvedValue({
				id: mockId(64),
				status: ShippingStatusEnum.SHIPPED,
			});

			await expect(
				service.updateStatus(entry, OrderReturnStatusEnum.CANCELED),
			).rejects.toMatchObject({ statusCode: 409 });

			expect(shipping.updateStatus).not.toHaveBeenCalled();
		});

		it('withdraws the movement when canceling before it left', async () => {
			const entry = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.APPROVED,
				shipping_id: mockId(64),
			});
			const movement = {
				id: mockId(64),
				status: ShippingStatusEnum.PENDING,
			};

			lockReturns(entry);
			shipping.findById.mockResolvedValue(movement);

			await service.updateStatus(entry, OrderReturnStatusEnum.CANCELED);

			expect(shipping.updateStatus).toHaveBeenCalledWith(
				movement,
				ShippingStatusEnum.CANCELED,
			);
			expect(manager.save).toHaveBeenCalledWith(
				expect.objectContaining({
					status: OrderReturnStatusEnum.CANCELED,
				}),
			);
		});

		it('refuses a move the transitions do not allow', async () => {
			await expect(
				service.updateStatus(
					getOrderReturnEntityMock(),
					OrderReturnStatusEnum.CLOSED,
				),
			).rejects.toBeDefined();
		});

		it('emails the buyer a rejection, falling back to the client contact', async () => {
			const entry = getOrderReturnEntityMock();

			lockReturns(entry);
			mockOrderReturn.query.firstOrFail.mockResolvedValue({
				...entry,
				status: OrderReturnStatusEnum.REJECTED,
				order: {
					id: mockId(118),
					ref_code: 'ORD',
					ref_number: 118,
					client_id: mockId(9),
				},
			} as never);
			repo(ClientEntity).findOne.mockResolvedValue({
				id: mockId(9),
				company_name: 'Test Company SRL',
				person_name: null,
				contact_name: null,
				contact_email: 'billing@example.com',
				user: null,
			});

			await service.updateStatus(
				entry,
				OrderReturnStatusEnum.REJECTED,
				'Outside the return window',
			);
			await flushBackground();

			expect(emails.send).toHaveBeenCalledWith(
				OrderReturnEmailEventEnum.REJECTED,
				expect.anything(),
				expect.objectContaining({
					name: 'Test Company SRL',
					address: 'billing@example.com',
				}),
			);
		});

		it('sends nothing when the client has no email at all', async () => {
			const entry = getOrderReturnEntityMock();

			lockReturns(entry);
			mockOrderReturn.query.firstOrFail.mockResolvedValue({
				...entry,
				order: {
					id: mockId(118),
					ref_code: 'ORD',
					ref_number: 118,
					client_id: mockId(9),
				},
			} as never);
			repo(ClientEntity).findOne.mockResolvedValue({
				id: mockId(9),
				contact_email: null,
				user: null,
			});

			await service.updateStatus(entry, OrderReturnStatusEnum.REJECTED);
			await flushBackground();

			expect(emails.send).not.toHaveBeenCalled();
		});

		it('emails nothing on a cancel', async () => {
			const entry = getOrderReturnEntityMock();

			lockReturns(entry);

			await service.updateStatus(entry, OrderReturnStatusEnum.CANCELED);
			await flushBackground();

			expect(emails.send).not.toHaveBeenCalled();
		});
	});

	describe('receiveForMovement', () => {
		it('ignores a movement no approved return stands behind', async () => {
			mockOrderReturn.query.first.mockResolvedValue(null);

			await service.receiveForMovement(mockId(64));

			expect(dataSource.transaction).not.toHaveBeenCalled();
		});

		it('ignores a repeated announcement', async () => {
			mockOrderReturn.query.first.mockResolvedValue(
				getOrderReturnEntityMock({
					status: OrderReturnStatusEnum.RECEIVED,
					shipping_id: mockId(64),
				}),
			);

			await service.receiveForMovement(mockId(64));

			expect(dataSource.transaction).not.toHaveBeenCalled();
		});

		it('moves the return to received, emails the buyer and drafts the refund', async () => {
			const approved = getOrderReturnEntityMock({
				status: OrderReturnStatusEnum.APPROVED,
				shipping_id: mockId(64),
			});

			mockOrderReturn.query.first.mockResolvedValue(approved);
			lockReturns(approved);
			mockOrderReturn.query.firstOrFail.mockResolvedValue({
				...approved,
				status: OrderReturnStatusEnum.RECEIVED,
				order: {
					id: mockId(118),
					ref_code: 'ORD',
					ref_number: 118,
					client_id: mockId(9),
				},
			} as never);
			repo(ClientEntity).findOne.mockResolvedValue({
				id: mockId(9),
				user: {
					id: mockId(42),
					name: 'Ana',
					email: 'ana@example.com',
					language: 'en',
				},
			});
			const draftRefund = jest
				.spyOn(service, 'draftRefund')
				.mockResolvedValue([]);

			await service.receiveForMovement(mockId(64));
			await flushBackground();

			expect(manager.save).toHaveBeenCalledWith(
				expect.objectContaining({
					status: OrderReturnStatusEnum.RECEIVED,
					received_at: expect.any(Date),
				}),
			);
			expect(draftRefund).toHaveBeenCalledWith(approved.id);
			expect(emails.send).toHaveBeenCalledWith(
				OrderReturnEmailEventEnum.RECEIVED,
				expect.anything(),
				expect.objectContaining({ address: 'ana@example.com' }),
			);
		});
	});

	describe('draftRefund', () => {
		const received = getOrderReturnEntityMock({
			status: OrderReturnStatusEnum.RECEIVED,
			shipping_id: mockId(64),
		});

		const productLine = (
			id: EntityId,
			orderLineId: EntityId,
			quantity: number,
			lineNet: number,
		) =>
			getInvoiceLineEntityMock({
				id: id,
				kind: InvoiceLineKindEnum.PRODUCT,
				order_line_id: orderLineId,
				shipping_id: null,
				quantity: quantity,
				line_net: lineNet,
			});

		beforeEach(() => {
			mockOrderReturn.query.firstOrFail.mockResolvedValue(received);
			mockOrderReturn.repository.update.mockResolvedValue({} as never);

			// What the movement actually carried: 3 of variant 27
			repo(ShippingLineEntity).find.mockResolvedValue([
				{ variant_id: mockId(27), quantity: '3' },
			]);
			repo(OrderLineEntity).find.mockResolvedValue([
				{ id: mockId(501), variant_id: mockId(27) },
				{ id: mockId(502), variant_id: mockId(28) },
			]);
			invoices.findIdsBySource.mockResolvedValue([
				mockId(10),
				mockId(11),
			]);
			repo(InvoiceEntity).find.mockResolvedValue([
				{ id: mockId(10) },
				{ id: mockId(11) },
			]);
			invoices.createReversal.mockImplementation(async (parent) => ({
				// The reversal of document n is document 900 + n
				id: mockId(
					900 + Number((parent as { id: EntityId }).id.slice(-12)),
				),
			}));
		});

		it('refuses before the goods arrived', async () => {
			mockOrderReturn.query.firstOrFail.mockResolvedValue(
				getOrderReturnEntityMock({
					status: OrderReturnStatusEnum.APPROVED,
				}),
			);

			await expect(
				service.draftRefund(received.id),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('refuses a second draft through this path', async () => {
			mockOrderReturn.query.firstOrFail.mockResolvedValue(
				getOrderReturnEntityMock({
					status: OrderReturnStatusEnum.RECEIVED,
					reversal_invoice_ids: [mockId(910)],
				}),
			);

			await expect(
				service.draftRefund(received.id),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		it('spreads the returned quantity over the documents oldest first, past earlier reversals', async () => {
			// Document 10 billed 2 of the variant, 1 already reversed - 1 left; document 11 billed 5
			invoices.getLines.mockImplementation(async (id: EntityId) =>
				id === mockId(10)
					? [
							productLine(mockId(1), mockId(501), 2, 200),
							productLine(mockId(2), mockId(502), 1, 50),
						]
					: [productLine(mockId(3), mockId(501), 5, 500)],
			);
			invoices.getReversedPerLine.mockImplementation(
				async (id: EntityId) =>
					id === mockId(10)
						? new Map([[mockId(1), { quantity: 1, net: 100 }]])
						: new Map(),
			);

			const raised = await service.draftRefund(received.id);

			expect(raised).toEqual([mockId(910), mockId(911)]);
			expect(invoices.createReversal).toHaveBeenNthCalledWith(
				1,
				{ id: mockId(10) },
				expect.objectContaining({
					lines: [
						{
							invoice_line_id: mockId(1),
							quantity: 1,
							amount: undefined,
						},
					],
				}),
			);
			expect(invoices.createReversal).toHaveBeenNthCalledWith(
				2,
				{ id: mockId(11) },
				expect.objectContaining({
					lines: [
						{
							invoice_line_id: mockId(3),
							quantity: 2,
							amount: undefined,
						},
					],
				}),
			);
			expect(mockOrderReturn.repository.update).toHaveBeenCalledWith(
				received.id,
				{ reversal_invoice_ids: [mockId(910), mockId(911)] },
			);
		});

		it('drafts nothing and records nothing when no issued document billed the goods', async () => {
			repo(InvoiceEntity).find.mockResolvedValue([]);

			const raised = await service.draftRefund(received.id);

			expect(raised).toEqual([]);
			expect(invoices.createReversal).not.toHaveBeenCalled();
			expect(mockOrderReturn.repository.update).not.toHaveBeenCalled();
		});

		it('leaves the delivery fee alone unless asked', async () => {
			invoices.getLines.mockResolvedValue([
				productLine(mockId(1), mockId(501), 3, 300),
			]);

			await service.draftRefund(received.id);

			expect(repo(InvoiceSourceEntity).find).not.toHaveBeenCalled();
		});

		describe('with refund_shipping', () => {
			const feeLine = getInvoiceLineEntityMock({
				id: mockId(40),
				kind: InvoiceLineKindEnum.SHIPPING,
				order_line_id: null,
				shipping_id: mockId(50),
				quantity: 1,
				line_net: 16.53,
			});

			beforeEach(() => {
				mockOrderReturn.query.firstOrFail.mockResolvedValue(
					getOrderReturnEntityMock({
						status: OrderReturnStatusEnum.RECEIVED,
						shipping_id: mockId(64),
						refund_shipping: true,
					}),
				);

				// Goods on document 10, the delivery's fee on document 20
				invoices.findIdsBySource.mockResolvedValue([mockId(10)]);
				repo(ShippingEntity).find.mockResolvedValue([
					{ id: mockId(50) },
				]);
				repo(InvoiceSourceEntity).find.mockResolvedValue([
					{ invoice_id: mockId(20) },
				]);
				repo(InvoiceEntity).find.mockImplementation(async (options) => {
					const ids = (
						options as { where: { id: { value: number[] } } }
					).where.id.value;

					return ids.map((id) => ({ id }));
				});
				invoices.getLines.mockImplementation(async (id: EntityId) =>
					id === mockId(10)
						? [productLine(mockId(1), mockId(501), 3, 300)]
						: [feeLine],
				);
			});

			// By value: a quantity reversal would release the movement and let it be billed again
			it('pays the fee back by value alongside the goods', async () => {
				const raised = await service.draftRefund(received.id);

				expect(raised).toEqual([mockId(910), mockId(920)]);
				expect(invoices.createReversal).toHaveBeenLastCalledWith(
					{ id: mockId(20) },
					expect.objectContaining({
						lines: [
							{
								invoice_line_id: mockId(40),
								quantity: undefined,
								amount: 16.53,
							},
						],
					}),
				);
			});

			it('takes back only what earlier reversals left of the fee', async () => {
				invoices.getReversedPerLine.mockImplementation(
					async (id: EntityId) =>
						id === mockId(20)
							? new Map([
									[mockId(40), { quantity: 0, net: 6.53 }],
								])
							: new Map(),
				);

				await service.draftRefund(received.id);

				expect(invoices.createReversal).toHaveBeenLastCalledWith(
					{ id: mockId(20) },
					expect.objectContaining({
						lines: [expect.objectContaining({ amount: 10 })],
					}),
				);
			});

			it('skips a fee already paid back in full', async () => {
				invoices.getReversedPerLine.mockImplementation(
					async (id: EntityId) =>
						id === mockId(20)
							? new Map([
									[mockId(40), { quantity: 0, net: 16.53 }],
								])
							: new Map(),
				);

				const raised = await service.draftRefund(received.id);

				expect(raised).toEqual([mockId(910)]);
				expect(invoices.createReversal).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe('delete', () => {
		it('refuses a return that moved goods', async () => {
			mockOrderReturn.query.firstOrFail.mockResolvedValue(
				getOrderReturnEntityMock({
					status: OrderReturnStatusEnum.APPROVED,
				}),
			);

			await expect(service.delete(mockId(7))).rejects.toMatchObject({
				statusCode: 409,
			});
			expect(mockOrderReturn.query.delete).not.toHaveBeenCalled();
		});

		it('deletes a request that moved nothing', async () => {
			mockOrderReturn.query.firstOrFail.mockResolvedValue(
				getOrderReturnEntityMock(),
			);

			await service.delete(mockId(7));

			expect(mockOrderReturn.query.delete).toHaveBeenCalled();
		});
	});

	describe('cancelOwn', () => {
		it('refuses to withdraw a decided request', async () => {
			orders.findOwnById.mockResolvedValue({ id: mockId(118) });
			mockOrderReturn.query.firstOrFail.mockResolvedValue(
				getOrderReturnEntityMock({
					status: OrderReturnStatusEnum.APPROVED,
				}),
			);

			await expect(
				service.cancelOwn(mockId(118), mockId(7), mockId(42)),
			).rejects.toMatchObject({
				statusCode: 409,
			});
		});

		it('resolves the return through an order the caller owns', async () => {
			orders.findOwnById.mockResolvedValue({ id: mockId(118) });
			mockOrderReturn.query.firstOrFail.mockResolvedValue(
				getOrderReturnEntityMock(),
			);
			lockReturns(getOrderReturnEntityMock());

			await service.cancelOwn(mockId(118), mockId(7), mockId(42));

			expect(orders.findOwnById).toHaveBeenCalledWith(
				mockId(118),
				mockId(42),
			);
			expect(mockOrderReturn.query.filterBy).toHaveBeenCalledWith(
				'order_id',
				mockId(118),
			);
		});
	});

	// Labels are looked up for the email and the reads; a product name in the default language
	it('names lines by product label, falling back to nothing', async () => {
		repo(OrderReturnLineEntity).find.mockResolvedValue([
			{
				order_return_id: mockId(7),
				variant_id: mockId(27),
				quantity: '1',
			},
		]);
		repo(ProductVariantEntity).find.mockResolvedValue([
			{ id: mockId(27), sku: 'OXF-M', product_id: mockId(12) },
		]);
		repo(ProductContentEntity).find.mockResolvedValue([
			{ product_id: mockId(12), label: 'Oxford shirt' },
		]);
		mockOrderReturn.query.firstOrFail.mockResolvedValue(
			getOrderReturnEntityMock() as never,
		);

		const entry = await service.getEntryData({
			id: mockId(7),
			withDeleted: false,
		});

		expect(entry.lines).toEqual([
			expect.objectContaining({
				variant_id: mockId(27),
				sku: 'OXF-M',
				label: 'Oxford shirt',
			}),
		]);
	});
});
