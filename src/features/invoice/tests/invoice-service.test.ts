import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import CashFlowEntity, {
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { CashFlowCategoryEnum } from '@/features/cash-flow/cash-flow-category.enum';
import { clientService } from '@/features/client/client.service';
import { clientAddressService } from '@/features/client-address/client-address.service';
import InvoiceEntity, {
	InvoicePaymentStatusEnum,
	InvoiceScopeEnum,
	InvoiceStatusEnum,
	type InvoiceWithSources,
} from '@/features/invoice/invoice.entity';
import {
	getInvoiceEntityMock,
	getInvoiceLineEntityMock,
	invoiceOutputPayloads,
} from '@/features/invoice/invoice.mock';
import type { InvoiceQuery } from '@/features/invoice/invoice.repository';
import { InvoiceService } from '@/features/invoice/invoice.service';
import type { InvoiceValidator } from '@/features/invoice/invoice.validator';
import type InvoiceLineEntity from '@/features/invoice/invoice-line.entity';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import type { InvoiceLineQuery } from '@/features/invoice/invoice-line.repository';
import InvoicePaymentEntity from '@/features/invoice/invoice-payment.entity';
import type { InvoicePaymentQuery } from '@/features/invoice/invoice-payment.repository';
import { InvoiceSourceTypeEnum } from '@/features/invoice/invoice-source.entity';
import type OrderEntity from '@/features/order/order.entity';
import { OrderStatusEnum } from '@/features/order/order.entity';
import { orderService } from '@/features/order/order.service';
import { roundMoney } from '@/helpers/shop.helper';
import {
	type BillableSource,
	type BillableSourceProvider,
	registerBillableSourceProvider,
} from '@/shared/registries/billable-source.registry';
import {
	createMockRepository,
	setupTransactionMock,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceUpdate,
} from '@/tests/jest-service.setup';

/** A stand-in for the provider `shipping.bootstrap.ts` registers, billing the given movements. */
function registerShippingProvider(
	sources: BillableSource[],
): BillableSourceProvider {
	const provider: BillableSourceProvider = {
		billedOnce: true,
		listBillable: async (orderId: number) =>
			sources.filter((source) => source.order_id === orderId),
		findBillable: async (sourceId: number) =>
			sources.find((source) => source.id === sourceId) ?? null,
		getLineCaps: async () => new Map(),
	};

	registerBillableSourceProvider(InvoiceSourceTypeEnum.SHIPPING, provider);

	return provider;
}

describe('InvoiceService', () => {
	afterEach(() => {
		registerBillableSourceProvider(InvoiceSourceTypeEnum.SHIPPING, null);
	});

	beforeEach(() => {
		jest.restoreAllMocks();

		// Sources live in `invoice_source`, read through the data source rather than the mocked
		// repositories; the invoice mocks already carry theirs, so loading them is a pass-through
		jest.spyOn(invoiceService, 'withSources').mockImplementation(
			async (entries) => entries as never,
		);
	});

	const mockInvoice = createMockRepository<InvoiceEntity, InvoiceQuery>();
	const mockLine = createMockRepository<
		InvoiceLineEntity,
		InvoiceLineQuery
	>();
	const mockPayment = createMockRepository<
		InvoicePaymentEntity,
		InvoicePaymentQuery
	>();

	const invoiceService = new InvoiceService(
		mockInvoice.repository,
		mockLine.repository,
		mockPayment.repository,
	);

	testServiceUpdate<InvoiceEntity>(
		invoiceService,
		mockInvoice.repository,
		getInvoiceEntityMock(),
	);

	testServiceFindById<InvoiceEntity, InvoiceQuery>(
		mockInvoice.query,
		invoiceService,
	);

	testServiceFindByFilter<InvoiceEntity, InvoiceQuery, InvoiceValidator>(
		mockInvoice.query,
		invoiceService,
		invoiceOutputPayloads.find,
	);

	describe('computeLine', () => {
		it('nets the discount off before charging VAT', () => {
			const result = invoiceService.computeLine({
				label: 'Test',
				quantity: 2,
				unit_price: 110,
				vat_rate: 21,
				discount_reduction: 20,
			});

			expect(result).toEqual({
				line_net: 200,
				line_vat: 42,
				line_total: 242,
				discount_reduction: 20,
			});
		});

		it('charges nothing at a zero rate', () => {
			const result = invoiceService.computeLine({
				label: 'Test',
				quantity: 1,
				unit_price: 49.99,
				vat_rate: 0,
			});

			expect(result.line_vat).toBe(0);
			expect(result.line_total).toBe(49.99);
		});

		/*
		 * The line columns are unsigned and the totals carry a `>= 0` CHECK, so a discount past
		 * the line value has to be refused here - the database would answer it as a masked 500.
		 */
		it('refuses a discount larger than the line value', () => {
			expect(() =>
				invoiceService.computeLine({
					label: 'Test',
					quantity: 1,
					unit_price: 10,
					vat_rate: 21,
					discount_reduction: 11,
				}),
			).toThrow('invoice.error.line_discount_exceeds_value');
		});
	});

	describe('computeTotals', () => {
		it('sums the lines into the four header figures', () => {
			const totals = invoiceService.computeTotals([
				getInvoiceLineEntityMock(),
				getInvoiceLineEntityMock({
					id: 2,
					discount_reduction: 0,
					line_net: 100,
					line_vat: 21,
					line_total: 121,
				}),
			]);

			expect(totals).toEqual({
				total_net: 300,
				total_discount_reduction: 20,
				total_vat: 63,
				total_gross: 363,
			});
		});

		it('is zero for a document with no lines', () => {
			expect(invoiceService.computeTotals([])).toEqual({
				total_net: 0,
				total_discount_reduction: 0,
				total_vat: 0,
				total_gross: 0,
			});
		});

		/*
		 * A basket routinely mixes VAT categories - food beside beer, plus shipping at the
		 * standard rate on a row of its own - and the header keeps the sum of what each line
		 * owes rather than a rate over the total. The second expectation is the reason the
		 * document holds lines at all: no single rate reproduces that sum, so a header carrying
		 * one `vat_rate` would be a cent light on this exact basket.
		 */
		it('sums VAT per line when the rates differ', () => {
			const totals = invoiceService.computeTotals([
				getInvoiceLineEntityMock({
					discount_reduction: 0,
					line_net: 100,
					line_vat: 21,
					line_total: 121,
				}),
				getInvoiceLineEntityMock({
					id: 2,
					vat_rate: 11,
					discount_reduction: 0,
					line_net: 100,
					line_vat: 11,
					line_total: 111,
				}),
				getInvoiceLineEntityMock({
					id: 3,
					kind: InvoiceLineKindEnum.SHIPPING,
					order_line_id: null,
					shipping_id: 1,
					discount_reduction: 0,
					line_net: 20,
					line_vat: 4.2,
					line_total: 24.2,
				}),
			]);

			expect(totals).toEqual({
				total_net: 220,
				total_discount_reduction: 0,
				total_vat: 36.2,
				total_gross: 256.2,
			});

			// The blended rate, at the `decimal(5,2)` the column would store it in
			const blended = roundMoney(
				(totals.total_vat / totals.total_net) * 100,
			);

			expect(
				roundMoney(totals.total_net * (1 + blended / 100)),
			).not.toEqual(totals.total_gross);
		});
	});

	describe('assertMutable', () => {
		it('accepts a draft', () => {
			expect(() =>
				invoiceService.assertMutable(
					getInvoiceEntityMock({
						status: InvoiceStatusEnum.DRAFT,
					}),
				),
			).not.toThrow();
		});

		it('refuses an issued document', () => {
			expect(() =>
				invoiceService.assertMutable(
					getInvoiceEntityMock({
						status: InvoiceStatusEnum.ISSUED,
					}),
				),
			).toThrow('invoice.error.update_not_allowed');
		});
	});

	describe('create', () => {
		// The movement goes on the header too, so the document is found by it without its lines
		it('names the movement on a shipping document', async () => {
			jest.spyOn(orderService, 'findById').mockResolvedValue({
				id: 1,
				client_id: 1,
				status: OrderStatusEnum.PENDING,
			} as unknown as OrderEntity);
			jest.spyOn(orderService, 'getLines').mockResolvedValue([]);
			registerShippingProvider([
				{
					id: 7,
					order_id: 1,
					lines: [
						{
							label: 'Delivery',
							quantity: 1,
							unit_price: 20,
							vat_rate: 21,
							discount_reduction: 0,
						},
					],
				},
			]);
			jest.spyOn(invoiceService, 'getBilledSourceIds').mockResolvedValue(
				new Set(),
			);

			const persist = jest
				.spyOn(
					invoiceService as unknown as {
						persist: (data: {
							entry: Partial<InvoiceEntity>;
							lines: Partial<InvoiceLineEntity>[];
						}) => Promise<InvoiceEntity>;
					},
					'persist',
				)
				.mockImplementation(
					async (data) => data.entry as InvoiceEntity,
				);

			await invoiceService.create({
				...invoiceOutputPayloads.create,
				scope: InvoiceScopeEnum.SHIPPING,
				shipping_id: 7,
			});

			const call = persist.mock.calls[0]?.[0];

			expect(call?.entry).toMatchObject({
				scope: InvoiceScopeEnum.SHIPPING,
				shipping_id: 7,
			});
			expect(call?.lines).toHaveLength(1);
			expect(call?.lines[0]).toMatchObject({
				kind: InvoiceLineKindEnum.SHIPPING,
				shipping_id: 7,
			});
		});

		// A `canceled` order was never charged. A `pending` one is billed up front, so it passes
		it('refuses a canceled order', async () => {
			// `order` ships no mock factory, and the guard reads one column
			jest.spyOn(orderService, 'findById').mockResolvedValue({
				id: 1,
				status: OrderStatusEnum.CANCELLED,
			} as unknown as OrderEntity);

			await expect(
				invoiceService.create(invoiceOutputPayloads.create),
			).rejects.toThrow('invoice.error.order_not_invoiceable');
		});
	});

	describe('buildOrderLines', () => {
		const order = {
			id: 1,
			client_id: 1,
			status: OrderStatusEnum.PENDING,
		} as unknown as OrderEntity;

		const orderLines = [
			{
				id: 10,
				product_id: 1,
				variant_id: 100,
				label: 'Chair',
				quantity: 10,
				price: 50,
				vat_rate: 21,
				discount: null,
				discount_reduction: 20,
			},
			{
				id: 11,
				product_id: 2,
				variant_id: 200,
				label: 'Table',
				quantity: 1,
				price: 300,
				vat_rate: 21,
				discount: null,
				discount_reduction: 0,
			},
		] as unknown as Awaited<ReturnType<typeof orderService.getLines>>;

		beforeEach(() => {
			jest.spyOn(orderService, 'getLines').mockResolvedValue(orderLines);
		});

		/*
		 * The goods only: each movement is billed on a `shipping` document of its own, so a
		 * delivery never shows up as a line of the order's document - and is never billed twice.
		 */
		it('writes product lines only, never a shipping line', async () => {
			jest.spyOn(invoiceService, 'getBilledQuantities').mockResolvedValue(
				new Map(),
			);
			const shippings = jest.spyOn(invoiceService, 'getUnbilledSources');

			const lines = await invoiceService.buildOrderLines(order);

			expect(lines.map((line) => line.kind)).toEqual([
				InvoiceLineKindEnum.PRODUCT,
				InvoiceLineKindEnum.PRODUCT,
			]);
			expect(lines.every((line) => !line.shipping_id)).toBe(true);
			expect(shippings).not.toHaveBeenCalled();
		});

		// What an earlier document billed is not billed again - the remainder is
		it('bills only what earlier documents left', async () => {
			jest.spyOn(invoiceService, 'getBilledQuantities').mockResolvedValue(
				new Map([
					[10, 3],
					[11, 1],
				]),
			);

			const lines = await invoiceService.buildOrderLines(order);

			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatchObject({
				order_line_id: 10,
				quantity: 7,
			});
		});

		// A partial quantity carries its share of the discount, so the parts add up to the line
		it('prorates the discount over a partial quantity', async () => {
			jest.spyOn(invoiceService, 'getBilledQuantities').mockResolvedValue(
				new Map(),
			);

			const lines = await invoiceService.buildOrderLines(order, [
				{ order_line_id: 10, quantity: 3 },
			]);

			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatchObject({
				quantity: 3,
				discount_reduction: 6,
				line_net: 144,
			});
		});

		it('refuses more than is left on a line', async () => {
			jest.spyOn(invoiceService, 'getBilledQuantities').mockResolvedValue(
				new Map([[10, 8]]),
			);

			await expect(
				invoiceService.buildOrderLines(order, [
					{ order_line_id: 10, quantity: 3 },
				]),
			).rejects.toThrow('invoice.error.order_line_over_billed');
		});

		it('refuses a line from another order', async () => {
			jest.spyOn(invoiceService, 'getBilledQuantities').mockResolvedValue(
				new Map(),
			);

			await expect(
				invoiceService.buildOrderLines(order, [
					{ order_line_id: 99, quantity: 1 },
				]),
			).rejects.toThrow('invoice.error.invalid_order_line');
		});
	});

	describe('raiseForOrder', () => {
		const order = {
			id: 1,
			client_id: 1,
			status: OrderStatusEnum.CONFIRMED,
		} as unknown as OrderEntity;

		beforeEach(() => {
			jest.spyOn(orderService, 'findById').mockResolvedValue(order);
		});

		/*
		 * The guard every automatic caller leans on: a checkout already billed the order, a
		 * second confirm - nothing is left, so nothing is raised.
		 */
		it('raises nothing when the order is billed in full', async () => {
			jest.spyOn(invoiceService, 'buildOrderLines').mockResolvedValue([]);

			const create = jest.spyOn(invoiceService, 'create');

			await expect(
				invoiceService.raiseForOrder(order.id),
			).resolves.toBeNull();

			expect(create).not.toHaveBeenCalled();
		});

		// The draft is worth nothing to an operator until it carries a number, so the two moves
		// are one call rather than leaving the document half-raised
		it('issues the order document it creates for the remainder', async () => {
			jest.spyOn(invoiceService, 'buildOrderLines').mockResolvedValue([
				{ order_line_id: 10, quantity: 1 },
			]);

			const draft = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
			});
			const issued = getInvoiceEntityMock({
				status: InvoiceStatusEnum.ISSUED,
			});

			const create = jest
				.spyOn(invoiceService, 'create')
				.mockResolvedValue(draft);
			jest.spyOn(invoiceService, 'issue').mockResolvedValue(issued);

			await expect(invoiceService.raiseForOrder(order.id)).resolves.toBe(
				issued,
			);

			expect(create).toHaveBeenCalledWith(
				expect.objectContaining({
					order_id: order.id,
					scope: InvoiceScopeEnum.ORDER,
				}),
			);
		});
	});

	describe('raiseForSource', () => {
		const movement: BillableSource = {
			id: 5,
			order_id: 1,
			lines: [
				{
					label: 'Delivery',
					quantity: 1,
					unit_price: 20,
					vat_rate: 21,
					discount_reduction: 0,
				},
			],
		};

		it('raises nothing for a movement a live document already bills', async () => {
			registerShippingProvider([movement]);
			jest.spyOn(invoiceService, 'getBilledSourceIds').mockResolvedValue(
				new Set([5]),
			);

			const create = jest.spyOn(invoiceService, 'create');

			await expect(
				invoiceService.raiseForSource(
					InvoiceSourceTypeEnum.SHIPPING,
					5,
				),
			).resolves.toBeNull();

			expect(create).not.toHaveBeenCalled();
		});

		// The provider answers null for a failed, free or order-less movement
		it('raises nothing for a movement its provider does not bill', async () => {
			registerShippingProvider([]);

			await expect(
				invoiceService.raiseForSource(
					InvoiceSourceTypeEnum.SHIPPING,
					5,
				),
			).resolves.toBeNull();
		});

		it('raises nothing when no provider is registered for the type', async () => {
			const create = jest.spyOn(invoiceService, 'create');

			await expect(
				invoiceService.raiseForSource(
					InvoiceSourceTypeEnum.SHIPPING,
					5,
				),
			).resolves.toBeNull();

			expect(create).not.toHaveBeenCalled();
		});

		it('issues a shipping document for an unbilled movement', async () => {
			registerShippingProvider([movement]);
			jest.spyOn(invoiceService, 'getBilledSourceIds').mockResolvedValue(
				new Set(),
			);

			const issued = getInvoiceEntityMock({
				scope: InvoiceScopeEnum.SHIPPING,
			});

			const create = jest
				.spyOn(invoiceService, 'create')
				.mockResolvedValue(issued);
			jest.spyOn(invoiceService, 'issue').mockResolvedValue(issued);

			await invoiceService.raiseForSource(
				InvoiceSourceTypeEnum.SHIPPING,
				5,
			);

			expect(create).toHaveBeenCalledWith(
				expect.objectContaining({
					order_id: 1,
					scope: InvoiceScopeEnum.SHIPPING,
					shipping_id: 5,
				}),
			);
		});
	});

	describe('getUnbilledSources', () => {
		it('lists the movements of an order no live document bills', async () => {
			registerShippingProvider([
				{ id: 5, order_id: 1, lines: [] },
				{ id: 6, order_id: 1, lines: [] },
				{ id: 7, order_id: 2, lines: [] },
			]);
			jest.spyOn(invoiceService, 'getBilledSourceIds').mockResolvedValue(
				new Set([5]),
			);

			const unbilled = await invoiceService.getUnbilledSources(1);

			expect(
				unbilled.map((entry) => [entry.source_type, entry.source.id]),
			).toEqual([[InvoiceSourceTypeEnum.SHIPPING, 6]]);
		});
	});

	describe('createReversal', () => {
		const parent = getInvoiceEntityMock({
			id: 1,
			scope: InvoiceScopeEnum.SHIPPING,
			shipping_id: 7,
			status: InvoiceStatusEnum.ISSUED,
		});

		const parentLines = [
			getInvoiceLineEntityMock({
				id: 10,
				invoice_id: 1,
				quantity: 4,
				unit_price: 50,
				vat_rate: 21,
				discount_reduction: 20,
				line_net: 180,
				line_vat: 37.8,
				line_total: 217.8,
			}),
			getInvoiceLineEntityMock({
				id: 11,
				invoice_id: 1,
				quantity: 1,
				unit_price: 30,
				vat_rate: 21,
				discount_reduction: 0,
				line_net: 30,
				line_vat: 6.3,
				line_total: 36.3,
			}),
		];

		const persisted = () => {
			const persist = jest.spyOn(
				invoiceService as unknown as {
					persist: (data: {
						entry: Partial<InvoiceEntity>;
						lines: Partial<InvoiceLineEntity>[];
					}) => Promise<InvoiceEntity>;
				},
				'persist',
			);

			persist.mockImplementation(
				async (data) => data.entry as InvoiceEntity,
			);

			return persist;
		};

		beforeEach(() => {
			jest.spyOn(invoiceService, 'getLines').mockResolvedValue(
				parentLines,
			);
		});

		const reversedSoFar = (
			entries: [number, { quantity: number; net: number }][],
		) =>
			jest
				.spyOn(invoiceService, 'getReversedPerLine')
				.mockResolvedValue(new Map(entries));

		const pick = (
			invoice_line_id: number,
			by: { quantity?: number; amount?: number },
		) => ({
			invoice_line_id: invoice_line_id,
			quantity: by.quantity,
			amount: by.amount,
		});

		it('refuses to reverse a reversal', async () => {
			await expect(
				invoiceService.createReversal(
					getInvoiceEntityMock({
						is_reversal: true,
						parent_invoice_id: 9,
					}),
					{ id: 1, lines: undefined, notes: undefined },
				),
			).rejects.toThrow('invoice.error.reversal_of_reversal');
		});

		it('refuses a parent that has not been issued', async () => {
			await expect(
				invoiceService.createReversal(
					getInvoiceEntityMock({ status: InvoiceStatusEnum.DRAFT }),
					{ id: 1, lines: undefined, notes: undefined },
				),
			).rejects.toThrow('invoice.error.reversal_parent_status');
		});

		// Same type, same movement and same figures as the original - a reversed shipping
		// document is still one
		it('takes back everything not reversed yet, as the same type', async () => {
			reversedSoFar([[11, { quantity: 1, net: 30 }]]);

			const persist = persisted();

			await invoiceService.createReversal(parent, {
				id: parent.id,
				lines: undefined,
				notes: undefined,
			});

			const data = persist.mock.calls[0]?.[0];

			expect(data?.entry).toMatchObject({
				scope: InvoiceScopeEnum.SHIPPING,
				shipping_id: 7,
				is_reversal: true,
				parent_invoice_id: parent.id,
				// The parties the original went out to, so it can be issued with no order behind it
				billing_details: parent.billing_details,
				seller_details: parent.seller_details,
			});
			expect(data?.lines).toHaveLength(1);
			expect(data?.lines[0]).toMatchObject({
				parent_line_id: 10,
				is_value_reversal: false,
				quantity: 4,
				line_total: 217.8,
			});
		});

		// A partial quantity carries its share of the discount, and its units go back to billable
		it('takes back part of a line by quantity', async () => {
			reversedSoFar([]);

			const persist = persisted();

			await invoiceService.createReversal(parent, {
				id: parent.id,
				lines: [pick(10, { quantity: 1 })],
				notes: undefined,
			});

			expect(persist.mock.calls[0]?.[0].lines[0]).toMatchObject({
				parent_line_id: 10,
				is_value_reversal: false,
				order_line_id: parentLines[0]?.order_line_id,
				quantity: 1,
				discount_reduction: 5,
				line_net: 45,
			});
		});

		// A price correction: one unit worth the net amount, VAT at the line's rate, no source row
		it('takes back value off a line the client keeps', async () => {
			reversedSoFar([]);

			const persist = persisted();

			await invoiceService.createReversal(parent, {
				id: parent.id,
				lines: [pick(10, { amount: 40 })],
				notes: undefined,
			});

			expect(persist.mock.calls[0]?.[0].lines[0]).toMatchObject({
				parent_line_id: 10,
				is_value_reversal: true,
				order_line_id: null,
				shipping_id: null,
				quantity: 1,
				unit_price: 40,
				line_net: 40,
				line_vat: 8.4,
				line_total: 48.4,
			});
		});

		it('refuses more value than earlier reversals left on a line', async () => {
			reversedSoFar([[10, { quantity: 0, net: 150 }]]);

			await expect(
				invoiceService.createReversal(parent, {
					id: parent.id,
					lines: [pick(10, { amount: 40 })],
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.reversal_value_over');
		});

		// Corrected by value first, the line cannot also hand back its units at full price
		it('refuses a quantity whose value no longer fits', async () => {
			reversedSoFar([[10, { quantity: 0, net: 100 }]]);

			await expect(
				invoiceService.createReversal(parent, {
					id: parent.id,
					lines: [pick(10, { quantity: 4 })],
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.reversal_value_over');
		});

		// By quantity only, like the dashboard form: a line whose units no longer fit after a value
		// correction is left out rather than turned into a value line
		it('defaults to quantity and leaves out a line whose units no longer fit', async () => {
			reversedSoFar([[10, { quantity: 0, net: 100 }]]);

			const persist = persisted();

			await invoiceService.createReversal(parent, {
				id: parent.id,
				lines: undefined,
				notes: undefined,
			});

			expect(persist.mock.calls[0]?.[0].lines).toHaveLength(1);
			expect(persist.mock.calls[0]?.[0].lines[0]).toMatchObject({
				parent_line_id: 11,
				is_value_reversal: false,
				quantity: 1,
			});
		});

		it('refuses a default reversal when no line has units that still fit', async () => {
			reversedSoFar([
				[10, { quantity: 0, net: 100 }],
				[11, { quantity: 1, net: 30 }],
			]);

			await expect(
				invoiceService.createReversal(parent, {
					id: parent.id,
					lines: undefined,
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.nothing_to_reverse');
		});

		it('refuses more quantity than earlier reversals left on a line', async () => {
			reversedSoFar([[10, { quantity: 3, net: 135 }]]);

			await expect(
				invoiceService.createReversal(parent, {
					id: parent.id,
					lines: [pick(10, { quantity: 2 })],
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.reversal_line_over');
		});

		it('refuses a line of another invoice', async () => {
			reversedSoFar([]);

			await expect(
				invoiceService.createReversal(parent, {
					id: parent.id,
					lines: [pick(99, { quantity: 1 })],
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.invalid_invoice_line');
		});

		it('refuses when everything has been reversed already', async () => {
			reversedSoFar([
				[10, { quantity: 4, net: 180 }],
				[11, { quantity: 1, net: 30 }],
			]);

			await expect(
				invoiceService.createReversal(parent, {
					id: parent.id,
					lines: undefined,
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.nothing_to_reverse');
		});
	});

	describe('createCustom', () => {
		const persisted = () =>
			jest
				.spyOn(
					invoiceService as unknown as {
						persist: (data: {
							entry: Partial<InvoiceEntity>;
							lines: Partial<InvoiceLineEntity>[];
						}) => Promise<InvoiceEntity>;
					},
					'persist',
				)
				.mockImplementation(
					async (data) => data.entry as InvoiceEntity,
				);

		// The lines and the parties are written through `update`, like on any draft
		it('raises an empty custom draft with no order', async () => {
			jest.spyOn(clientService, 'findById').mockResolvedValue({
				id: 5,
			} as never);
			jest.spyOn(
				clientAddressService,
				'getBillingSnapshotForClient',
			).mockResolvedValue(null);

			const persist = persisted();

			await invoiceService.createCustom({ client_id: 5 } as never);

			const call = persist.mock.calls[0]?.[0];

			expect(call?.entry).toMatchObject({
				client_id: 5,
				order_id: null,
				subscription_id: null,
				scope: InvoiceScopeEnum.CUSTOM,
				status: InvoiceStatusEnum.DRAFT,
				billing_details: null,
			});
			expect(call?.lines).toEqual([]);
		});

		// There is no order to resolve the buyer from at issue time, so it is frozen now
		it('freezes the buyer from the client billing address when there is one', async () => {
			jest.spyOn(clientService, 'findById').mockResolvedValue({
				id: 5,
				client_type: 'company',
				company_name: 'Acme SRL',
			} as never);
			jest.spyOn(
				clientAddressService,
				'getBillingSnapshotForClient',
			).mockResolvedValue({
				address_country: 'Romania',
				address_region: null,
				address_city: 'Cluj-Napoca',
				details: null,
				postal_code: null,
			} as never);

			const persist = persisted();

			await invoiceService.createCustom({ client_id: 5 } as never);

			expect(
				persist.mock.calls[0]?.[0].entry.billing_details,
			).toMatchObject({
				type: 'company',
				company_name: 'Acme SRL',
				address_city: 'Cluj-Napoca',
			});
		});
	});

	describe('refundReversal', () => {
		type RefundApi = {
			refundReversal: (
				manager: EntityManager,
				reversal: InvoiceEntity,
			) => Promise<number[]>;
			getRefundedForParent: (
				manager: EntityManager,
				parentId: number,
			) => Promise<number>;
		};

		const privateApi = invoiceService as unknown as RefundApi;

		const reversal = getInvoiceEntityMock({
			id: 50,
			is_reversal: true,
			parent_invoice_id: 40,
			status: InvoiceStatusEnum.ISSUED,
			ref_code: 'INV',
			ref_number: 21,
			total_gross: 1210,
		});

		const parent = getInvoiceEntityMock({
			id: 40,
			status: InvoiceStatusEnum.ISSUED,
			total_gross: 1210,
		});

		// A completed payment of 1210 gross: 1000 net at 21%, scaled to four decimals
		const movement = {
			id: 9,
			direction: CashFlowDirectionEnum.IN,
			method: 'bank_transfer',
			currency: 'RON',
			vat_rate: 21,
			amount: 1000 * 10 ** 4,
		} as unknown as CashFlowEntity;

		const arrange = (data: {
			allocations: { amount: number }[];
			reversed: number;
			refunded?: number;
		}) => {
			const savedAllocations: unknown[] = [];

			const repositories = new Map<unknown, unknown>([
				[
					InvoiceEntity,
					{ findOneByOrFail: jest.fn(async () => parent) },
				],
				[
					InvoicePaymentEntity,
					{
						find: jest.fn(async () =>
							data.allocations.map((allocation, index) => ({
								id: index + 1,
								invoice_id: parent.id,
								cash_flow_id: movement.id,
								amount: allocation.amount,
							})),
						),
						save: jest.fn(async (row: unknown) => {
							savedAllocations.push(row);

							return row;
						}),
					},
				],
				[
					CashFlowEntity,
					{ save: jest.fn(async (row: unknown) => row) },
				],
			]);

			const manager = {
				getRepository: jest.fn((entity: unknown) =>
					repositories.get(entity),
				),
				create: jest.fn((_entity: unknown, row: unknown) => row),
			} as unknown as EntityManager;

			jest.spyOn(invoiceService, 'getReversedAmount').mockResolvedValue(
				data.reversed,
			);
			jest.spyOn(privateApi, 'getRefundedForParent').mockResolvedValue(
				data.refunded ?? 0,
			);
			jest.spyOn(cashFlowService, 'findById').mockResolvedValue(movement);
			jest.spyOn(
				cashFlowService,
				'getRefundedAmountSum',
			).mockResolvedValue(0);
			jest.spyOn(
				invoiceService,
				'recomputePaymentStatus',
			).mockResolvedValue(reversal);

			const createWithin = jest
				.spyOn(cashFlowService, 'createWithin')
				.mockImplementation(
					async (_manager, row) =>
						({ id: 77, ...row }) as unknown as CashFlowEntity,
				);
			// Completing through `cash-flow` is what books the refund on the client ledger
			const completeWithin = jest
				.spyOn(cashFlowService, 'completeWithin')
				.mockImplementation(
					async (_manager, row) =>
						({
							...row,
							status: CashFlowStatusEnum.COMPLETED,
						}) as unknown as CashFlowEntity,
				);

			return {
				manager: manager,
				createWithin: createWithin,
				completeWithin: completeWithin,
				savedAllocations: savedAllocations,
			};
		};

		// An unpaid original is owed nothing back: the reversal only lowers the debt
		it('moves no money when nothing was paid on the original', async () => {
			const { manager, createWithin } = arrange({
				allocations: [],
				reversed: 1210,
			});

			await expect(
				privateApi.refundReversal(manager, reversal),
			).resolves.toEqual([]);
			expect(createWithin).not.toHaveBeenCalled();
		});

		// Paid in full, reversed in full: all of it goes back, completed, booked and allocated
		it('refunds a paid original in full and books it', async () => {
			const { manager, createWithin, completeWithin, savedAllocations } =
				arrange({ allocations: [{ amount: 1210 }], reversed: 1210 });

			await expect(
				privateApi.refundReversal(manager, reversal),
			).resolves.toEqual([9]);

			expect(createWithin.mock.calls[0]?.[1]).toMatchObject({
				direction: CashFlowDirectionEnum.OUT,
				category: CashFlowCategoryEnum.REFUND,
				parent_id: 9,
				amount: 1000,
				vat_rate: 21,
			});
			// Completed through `cash-flow`, which books it on the ledger in this transaction
			expect(completeWithin.mock.calls[0]?.[1]).toMatchObject({ id: 77 });
			expect(savedAllocations).toEqual([
				expect.objectContaining({
					invoice_id: 50,
					cash_flow_id: 77,
					amount: 1210,
				}),
			]);
		});

		// Only what was overpaid goes back - 600 paid of 1210, all reversed, returns 600
		it('refunds no more than was paid on the original', async () => {
			const { manager, savedAllocations } = arrange({
				allocations: [{ amount: 600 }],
				reversed: 1210,
			});

			await privateApi.refundReversal(manager, reversal);

			expect(savedAllocations).toEqual([
				expect.objectContaining({ amount: 600 }),
			]);
		});

		// A second reversal does not hand back what an earlier one already refunded
		it('leaves out what earlier reversals refunded', async () => {
			const { manager, savedAllocations } = arrange({
				allocations: [{ amount: 1210 }],
				reversed: 1210,
				refunded: 1000,
			});

			await privateApi.refundReversal(manager, reversal);

			expect(savedAllocations).toEqual([
				expect.objectContaining({ amount: 210 }),
			]);
		});
	});

	describe('reversible net on a listing', () => {
		// What lets the listing offer the reverse action only while something is left to take back
		it('reports what each issued original has left, null on the rest', async () => {
			const builder = {
				select: jest.fn(() => builder),
				addSelect: jest.fn(() => builder),
				where: jest.fn(() => builder),
				andWhere: jest.fn(() => builder),
				groupBy: jest.fn(() => builder),
				getRawMany: jest.fn(async () => [
					{ parent_invoice_id: 1, reversed_net: '500' },
					{ parent_invoice_id: 2, reversed_net: '120' },
				]),
			};

			jest.spyOn(
				mockInvoice.repository,
				'createQueryBuilder',
			).mockReturnValue(builder as never);

			const withReversibleNet = (
				invoiceService as unknown as {
					withReversibleNet: (
						entries: InvoiceEntity[],
					) => Promise<
						(InvoiceEntity & { reversible_net: number | null })[]
					>;
				}
			).withReversibleNet.bind(invoiceService);

			const result = await withReversibleNet([
				getInvoiceEntityMock({
					id: 1,
					status: InvoiceStatusEnum.ISSUED,
					total_net: 500,
				}),
				getInvoiceEntityMock({
					id: 2,
					status: InvoiceStatusEnum.ISSUED,
					total_net: 500,
				}),
				getInvoiceEntityMock({
					id: 3,
					status: InvoiceStatusEnum.DRAFT,
				}),
				getInvoiceEntityMock({
					id: 4,
					status: InvoiceStatusEnum.ISSUED,
					is_reversal: true,
					parent_invoice_id: 1,
				}),
			]);

			expect(result.map((entry) => entry.reversible_net)).toEqual([
				0,
				380,
				null,
				null,
			]);
		});

		// What the allocate form starts from: total less allocations and, on an original, issued reversals
		it('reports what each issued document still asks for, null on the rest', async () => {
			const builder = (rows: object[]) => {
				const stub = {
					select: jest.fn(() => stub),
					addSelect: jest.fn(() => stub),
					where: jest.fn(() => stub),
					andWhere: jest.fn(() => stub),
					groupBy: jest.fn(() => stub),
					getRawMany: jest.fn(async () => rows),
				};

				return stub;
			};

			jest.spyOn(
				mockPayment.repository,
				'createQueryBuilder',
			).mockReturnValue(
				builder([
					{ invoice_id: 1, allocated: '400' },
					{ invoice_id: 2, allocated: '1000' },
					{ invoice_id: 4, allocated: '50' },
				]) as never,
			);
			jest.spyOn(
				mockInvoice.repository,
				'createQueryBuilder',
			).mockReturnValue(
				builder([{ parent_invoice_id: 2, reversed: '300' }]) as never,
			);

			const withOutstanding = (
				invoiceService as unknown as {
					withOutstanding: (
						entries: InvoiceEntity[],
					) => Promise<
						(InvoiceEntity & {
							amount_outstanding: number | null;
						})[]
					>;
				}
			).withOutstanding.bind(invoiceService);

			const result = await withOutstanding([
				// Partly paid
				getInvoiceEntityMock({
					id: 1,
					status: InvoiceStatusEnum.ISSUED,
					total_gross: 1000,
				}),
				// Paid in full, then partly reversed - owed nothing, never below zero
				getInvoiceEntityMock({
					id: 2,
					status: InvoiceStatusEnum.ISSUED,
					total_gross: 1000,
				}),
				getInvoiceEntityMock({
					id: 3,
					status: InvoiceStatusEnum.DRAFT,
				}),
				// A reversal counts only the refunds allocated to it
				getInvoiceEntityMock({
					id: 4,
					status: InvoiceStatusEnum.ISSUED,
					is_reversal: true,
					parent_invoice_id: 2,
					total_gross: 300,
				}),
			]);

			expect(result.map((entry) => entry.amount_outstanding)).toEqual([
				600,
				0,
				null,
				250,
			]);
		});
	});

	describe('invoice sources', () => {
		// What a document was raised from is a link row, never a column of `invoice`
		it('writes the sources as invoice_source rows, not on the invoice', async () => {
			const saved: unknown[] = [];
			const { manager } = setupTransactionMock({
				save: jest.fn(async (row: unknown) => {
					saved.push(row);

					return Array.isArray(row)
						? row
						: { id: 40, ...(row as object) };
				}),
			});

			(manager as unknown as { create: unknown }).create = jest.fn(
				(_entity: unknown, row: unknown) => row,
			);

			const persist = (
				invoiceService as unknown as {
					persist: (data: {
						entry: Record<string, unknown>;
						lines: unknown[];
					}) => Promise<InvoiceWithSources>;
				}
			).persist.bind(invoiceService);

			const result = await persist({
				entry: {
					client_id: 1,
					order_id: 7,
					shipping_id: 9,
					subscription_id: null,
					scope: InvoiceScopeEnum.SHIPPING,
				},
				lines: [],
			});

			expect(saved[0]).not.toHaveProperty('order_id');
			expect(saved[0]).not.toHaveProperty('shipping_id');
			expect(saved[1]).toEqual([
				{
					invoice_id: 40,
					source_type: InvoiceSourceTypeEnum.ORDER,
					source_id: 7,
				},
				{
					invoice_id: 40,
					source_type: InvoiceSourceTypeEnum.SHIPPING,
					source_id: 9,
				},
			]);
			expect(result).toMatchObject({
				order_id: 7,
				shipping_id: 9,
				subscription_id: null,
			});
		});

		// A listing filters by source through `invoice_source`, each source its own parameters
		it('filters a listing by order and shipping through invoice_source', async () => {
			mockInvoice.query.all.mockResolvedValue([[], 0]);

			await invoiceService.findByFilter({
				...invoiceOutputPayloads.find,
				filter: {
					...invoiceOutputPayloads.find.filter,
					order_id: 5,
					shipping_id: 6,
				},
			});

			expect(mockInvoice.query.filterRaw).toHaveBeenCalledWith(
				expect.stringContaining('invoice_source'),
				{ source_order_type: 'order', source_order_id: 5 },
			);
			expect(mockInvoice.query.filterRaw).toHaveBeenCalledWith(
				expect.stringContaining('invoice_source'),
				{ source_shipping_type: 'shipping', source_shipping_id: 6 },
			);
		});
	});

	describe('cancel', () => {
		// An issued document is taken back by a reversal, never canceled
		it('refuses anything but a draft', async () => {
			await expect(
				invoiceService.cancel(
					getInvoiceEntityMock({ status: InvoiceStatusEnum.ISSUED }),
				),
			).rejects.toThrow('invoice.error.cancel_not_draft');
		});

		// A draft has no number or allocation, so withdrawing it touches only itself
		it('cancels a draft by its status alone', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
			});

			const update = jest
				.spyOn(invoiceService, 'update')
				.mockImplementation(async (row) => row as InvoiceEntity);

			await invoiceService.cancel(entry);

			expect(update).toHaveBeenCalledWith({
				id: entry.id,
				status: InvoiceStatusEnum.CANCELLED,
			});
		});
	});

	describe('updateData with parties', () => {
		// A reversal bills the buyer of the invoice it takes back
		it('refuses billing or seller details on a reversal', async () => {
			await expect(
				invoiceService.updateData(
					getInvoiceEntityMock({
						status: InvoiceStatusEnum.DRAFT,
						is_reversal: true,
					}),
					{ id: 1, seller_details: null } as never,
				),
			).rejects.toThrow('invoice.error.reversal_party_locked');
		});

		// Stated by hand, a party is stored on the draft and issuing freezes it as given
		it('stores the billing details stated by hand', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
				billing_details: null,
			});
			const billing = {
				...getInvoiceEntityMock().billing_details,
				address_city: 'Sibiu',
			};

			const update = jest
				.spyOn(invoiceService, 'update')
				.mockImplementation(async (row) => row as InvoiceEntity);

			await invoiceService.updateData(entry, {
				id: entry.id,
				billing_details: billing,
			} as never);

			expect(update).toHaveBeenCalledWith(
				expect.objectContaining({ billing_details: billing }),
			);
		});
	});

	describe('getEntryData parties', () => {
		// What a draft's edit form starts from: the buyer the row holds, the seller from config
		it('previews the parties issuing would freeze on a draft', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
				order_id: null,
			});

			mockInvoice.query.firstOrFail.mockResolvedValue(entry);
			mockLine.query.all.mockResolvedValue(
				[] as unknown as [InvoiceLineEntity[], number],
			);
			mockPayment.query.all.mockResolvedValue(
				[] as unknown as [InvoicePaymentEntity[], number],
			);
			jest.spyOn(invoiceService, 'getReversedPerLine').mockResolvedValue(
				new Map(),
			);
			jest.spyOn(invoiceService, 'getLineCaps').mockResolvedValue(
				new Map(),
			);

			const result = await invoiceService.getEntryData({
				id: entry.id,
			});

			expect(result.resolved_billing_details).toEqual(
				entry.billing_details,
			);
			expect(result.resolved_seller_details).toMatchObject({
				company_name: expect.any(String),
			});
		});

		it('previews nothing on an issued document', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.ISSUED,
			});

			mockInvoice.query.firstOrFail.mockResolvedValue(entry);
			mockLine.query.all.mockResolvedValue(
				[] as unknown as [InvoiceLineEntity[], number],
			);
			mockPayment.query.all.mockResolvedValue(
				[] as unknown as [InvoicePaymentEntity[], number],
			);
			jest.spyOn(invoiceService, 'getReversedPerLine').mockResolvedValue(
				new Map(),
			);

			const result = await invoiceService.getEntryData({
				id: entry.id,
			});

			expect(result).not.toHaveProperty('resolved_billing_details');
			expect(result).not.toHaveProperty('resolved_seller_details');
		});
	});

	describe('updateData with lines', () => {
		const draft = () =>
			getInvoiceEntityMock({ status: InvoiceStatusEnum.DRAFT });

		/** The figures a line already reads, as the window sends them back unchanged. */
		const asItem = (line: InvoiceLineEntity) => ({
			id: line.id,
			label: line.label,
			quantity: Number(line.quantity),
			unit_price: Number(line.unit_price),
			vat_rate: Number(line.vat_rate),
			discount_reduction: Number(line.discount_reduction),
		});

		const arrange = (lines: InvoiceLineEntity[]) => {
			const repository = {
				save: jest.fn(async (rows: unknown) => rows),
				softDelete: jest.fn(async (_ids: number[]) => undefined),
			};

			setupTransactionMock(repository);

			jest.spyOn(invoiceService, 'getLines').mockResolvedValue(lines);
			jest.spyOn(invoiceService, 'getLineCaps').mockResolvedValue(
				new Map([[7, { max_quantity: 2, max_unit_price: 110 }]]),
			);
			jest.spyOn(invoiceService, 'recomputeTotals').mockResolvedValue({
				total_net: 0,
				total_discount_reduction: 0,
				total_vat: 0,
				total_gross: 0,
			});
			mockInvoice.query.firstOrFail.mockResolvedValue(draft());

			return repository;
		};

		// The set is the whole draft: restated, added and left-out lines land in one write
		it('restates, adds and removes in one transaction, skipping unchanged lines', async () => {
			const restated = getInvoiceLineEntityMock({ id: 7 });
			const unchanged = getInvoiceLineEntityMock({ id: 8 });
			const dropped = getInvoiceLineEntityMock({ id: 9 });
			const repository = arrange([restated, unchanged, dropped]);

			await invoiceService.updateData(draft(), {
				id: 1,
				lines: [
					{ ...asItem(restated), quantity: 1 },
					asItem(unchanged),
					{
						label: 'Rounding',
						quantity: 1,
						unit_price: 0.5,
						vat_rate: 0,
					},
				],
			} as never);

			expect(repository.softDelete).toHaveBeenCalledWith([9]);

			const saved = repository.save.mock.calls.at(-1)?.[0] as
				| InvoiceLineEntity[]
				| undefined;

			expect(saved?.map((line) => line.id ?? 'new')).toEqual([7, 'new']);
			expect(saved?.[0]).toMatchObject({ quantity: 1 });
			expect(saved?.[1]).toMatchObject({
				kind: InvoiceLineKindEnum.ADJUSTMENT,
				line_total: 0.5,
			});
		});

		// A product line bills no more of its order line than is left, checked before any write
		it('refuses a line over its cap and writes nothing', async () => {
			const line = getInvoiceLineEntityMock({ id: 7 });
			const repository = arrange([line]);

			await expect(
				invoiceService.updateData(draft(), {
					id: 1,
					lines: [{ ...asItem(line), quantity: 3 }],
				} as never),
			).rejects.toThrow('invoice.error.line_quantity_over');

			expect(repository.save).not.toHaveBeenCalled();
			expect(repository.softDelete).not.toHaveBeenCalled();
		});

		it('refuses a line id that is not on this invoice', async () => {
			arrange([getInvoiceLineEntityMock({ id: 7 })]);

			await expect(
				invoiceService.updateData(draft(), {
					id: 1,
					lines: [
						{ ...asItem(getInvoiceLineEntityMock({ id: 99 })) },
					],
				} as never),
			).rejects.toThrow('invoice.error.invalid_invoice_line');
		});

		// A reversal's figures follow its original - nothing new, nothing restated
		it('refuses a new line on a reversal', async () => {
			arrange([]);

			await expect(
				invoiceService.updateData(
					getInvoiceEntityMock({
						status: InvoiceStatusEnum.DRAFT,
						is_reversal: true,
					}),
					{
						id: 1,
						lines: [
							{
								label: 'Rounding',
								quantity: 1,
								unit_price: 1,
								vat_rate: 0,
							},
						],
					} as never,
				),
			).rejects.toThrow('invoice.error.reversal_line_locked');
		});
	});

	describe('updateStatus', () => {
		it('refuses a move the entity does not allow', async () => {
			await expect(
				invoiceService.updateStatus(
					getInvoiceEntityMock({
						status: InvoiceStatusEnum.CANCELLED,
					}),
					InvoiceStatusEnum.ISSUED,
				),
			).rejects.toThrow('shared.error.status_update_not_allowed');
		});

		it('refuses a move to the status already held', async () => {
			await expect(
				invoiceService.updateStatus(
					getInvoiceEntityMock({ status: InvoiceStatusEnum.ISSUED }),
					InvoiceStatusEnum.ISSUED,
				),
			).rejects.toThrow('shared.error.status_unchanged');
		});

		// The two moves are different kinds of write - one spends a number, the other only
		// invalidates - so the transition check picks between them rather than saving directly
		it('routes a draft going to issued through issue', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
			});

			const issue = jest
				.spyOn(invoiceService, 'issue')
				.mockResolvedValue(entry);

			await invoiceService.updateStatus(entry, InvoiceStatusEnum.ISSUED);

			expect(issue).toHaveBeenCalledWith(entry);
		});

		it('routes a draft cancel through cancel', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
			});

			const cancel = jest
				.spyOn(invoiceService, 'cancel')
				.mockResolvedValue(entry);

			await invoiceService.updateStatus(
				entry,
				InvoiceStatusEnum.CANCELLED,
			);

			expect(cancel).toHaveBeenCalledWith(entry);
		});

		// An issued document is taken back by a reversal - no status move reaches it
		it('refuses to cancel an issued document', async () => {
			const cancel = jest.spyOn(invoiceService, 'cancel');

			await expect(
				invoiceService.updateStatus(
					getInvoiceEntityMock({ status: InvoiceStatusEnum.ISSUED }),
					InvoiceStatusEnum.CANCELLED,
				),
			).rejects.toThrow();
			expect(cancel).not.toHaveBeenCalled();
		});
	});

	describe('issue', () => {
		it('refuses a document with no lines', async () => {
			// `all` is overloaded, so the mock types against its widest signature - a plain
			// array result has to say so
			mockLine.query.all.mockResolvedValue(
				[] as unknown as [InvoiceLineEntity[], number],
			);

			await expect(
				invoiceService.issue(
					getInvoiceEntityMock({ status: InvoiceStatusEnum.DRAFT }),
				),
			).rejects.toThrow('invoice.error.no_lines');
		});
	});

	describe('resolveDueAt', () => {
		const issuedAt = new Date('2026-10-06T12:00:00Z');

		it('keeps a due date still ahead of the issue', () => {
			const dueAt = new Date('2026-10-20T00:00:00Z');

			expect(invoiceService.resolveDueAt(dueAt, issuedAt)).toBe(dueAt);
		});

		// A draft left open past its own due date would go out already overdue
		it('replaces a due date already passed with the standard term', () => {
			const resolved = invoiceService.resolveDueAt(
				new Date('2026-10-03T00:00:00Z'),
				issuedAt,
			);

			expect(resolved.getTime()).toBeGreaterThan(Date.now());
		});

		it('stamps the standard term when the draft named none', () => {
			expect(
				invoiceService.resolveDueAt(null, issuedAt).getTime(),
			).toBeGreaterThan(Date.now());
		});
	});

	describe('getEntryData', () => {
		// An original's lines carry what earlier reversals took back - what the reverse form caps at
		it('returns the document with its lines, allocations and reversed totals', async () => {
			const entry = getInvoiceEntityMock();
			const lines = [getInvoiceLineEntityMock({ id: 7 })];

			mockInvoice.query.firstOrFail.mockResolvedValue(entry);
			mockLine.query.all.mockResolvedValue(
				lines as unknown as [InvoiceLineEntity[], number],
			);
			mockPayment.query.all.mockResolvedValue(
				[] as unknown as [InvoicePaymentEntity[], number],
			);
			jest.spyOn(invoiceService, 'getReversedPerLine').mockResolvedValue(
				new Map([[7, { quantity: 1, net: 100 }]]),
			);

			const result = await invoiceService.getEntryData({
				id: entry.id,
			});

			expect(result.id).toBe(entry.id);
			expect(result.lines[0]).toMatchObject({
				id: 7,
				reversed_quantity: 1,
				reversed_net: 100,
			});
			expect(result.payments).toEqual([]);
		});

		// A draft's lines carry how far each may be restated - what the manage window caps at
		it('reports the restatement caps on a draft, null where a line has none', async () => {
			// No order, so the buyer preview reads the row rather than resolving an order
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
				order_id: null,
			});
			const lines = [
				getInvoiceLineEntityMock({ id: 7 }),
				getInvoiceLineEntityMock({ id: 8 }),
			];

			mockInvoice.query.firstOrFail.mockResolvedValue(entry);
			mockLine.query.all.mockResolvedValue(
				lines as unknown as [InvoiceLineEntity[], number],
			);
			mockPayment.query.all.mockResolvedValue(
				[] as unknown as [InvoicePaymentEntity[], number],
			);
			jest.spyOn(invoiceService, 'getReversedPerLine').mockResolvedValue(
				new Map(),
			);
			jest.spyOn(invoiceService, 'getLineCaps').mockResolvedValue(
				new Map([[7, { max_quantity: 2, max_unit_price: 50 }]]),
			);

			const result = await invoiceService.getEntryData({
				id: entry.id,
			});

			expect(result.lines[0]).toMatchObject({
				max_quantity: 2,
				max_unit_price: 50,
			});
			expect(result.lines[1]).toMatchObject({
				max_quantity: null,
				max_unit_price: null,
			});
		});
	});

	describe('recomputePaymentStatus', () => {
		it('reads paid once the allocations meet the total, and stamps paid_at', async () => {
			const entry = getInvoiceEntityMock({
				total_gross: 242,
				payment_status: InvoicePaymentStatusEnum.UNPAID,
				paid_at: null,
			});

			const manager = {
				getRepository: jest.fn(() => ({
					createQueryBuilder: jest.fn(() => ({
						select: jest.fn().mockReturnThis(),
						where: jest.fn().mockReturnThis(),
						andWhere: jest.fn().mockReturnThis(),
						getRawOne: jest.fn(async () => ({ allocated: '242' })),
					})),
					save: jest.fn(async (row: unknown) => row),
				})),
			} as unknown as Parameters<
				typeof invoiceService.recomputePaymentStatus
			>[0];

			const result = await invoiceService.recomputePaymentStatus(
				manager,
				entry,
			);

			expect(result.payment_status).toBe(InvoicePaymentStatusEnum.PAID);
			expect(result.paid_at).not.toBeNull();
		});

		// Cleared again when an allocation goes, unlike `overdue_at`, which is history
		it('clears paid_at when the allocations no longer cover the total', async () => {
			const entry = getInvoiceEntityMock({
				total_gross: 242,
				payment_status: InvoicePaymentStatusEnum.PAID,
				paid_at: new Date(),
			});

			const manager = {
				getRepository: jest.fn(() => ({
					createQueryBuilder: jest.fn(() => ({
						select: jest.fn().mockReturnThis(),
						where: jest.fn().mockReturnThis(),
						andWhere: jest.fn().mockReturnThis(),
						getRawOne: jest.fn(async () => ({ allocated: '100' })),
					})),
					save: jest.fn(async (row: unknown) => row),
				})),
			} as unknown as Parameters<
				typeof invoiceService.recomputePaymentStatus
			>[0];

			const result = await invoiceService.recomputePaymentStatus(
				manager,
				entry,
			);

			expect(result.payment_status).toBe(
				InvoicePaymentStatusEnum.PARTIAL,
			);
			expect(result.paid_at).toBeNull();
		});
	});
});
