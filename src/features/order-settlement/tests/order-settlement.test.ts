import { expect, jest } from '@jest/globals';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { invoiceService } from '@/features/invoice/invoice.service';
import type OrderEntity from '@/features/order/order.entity';
import {
	type OrderStatus,
	OrderStatusEnum,
} from '@/features/order/order.entity';
import { orderService } from '@/features/order/order.service';
import {
	OrderSettlementService,
	type OrderSettlementState,
} from '@/features/order-settlement/order-settlement.service';
import { shippingService } from '@/features/shipping/shipping.service';

const orderWith = (status: OrderStatus): OrderEntity =>
	({ id: 1, client_id: 1, status: status }) as unknown as OrderEntity;

const state = (
	overrides: Partial<OrderSettlementState>,
): OrderSettlementState => ({
	fully_invoiced: true,
	all_paid: true,
	delivered: true,
	...overrides,
});

describe('OrderSettlementService.evaluate', () => {
	const service = new OrderSettlementService();

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const run = async (
		status: OrderStatus,
		settlement: OrderSettlementState,
		prepaid?: { billed: boolean; paid: number; payable: number },
	) => {
		const order = orderWith(status);

		jest.spyOn(orderService, 'findById').mockResolvedValue(order);
		jest.spyOn(service, 'getState').mockResolvedValue(settlement);
		jest.spyOn(invoiceService, 'hasLiveOrderInvoice').mockResolvedValue(
			prepaid?.billed ?? true,
		);
		jest.spyOn(cashFlowService, 'sumCompletedForOrder').mockResolvedValue(
			prepaid?.paid ?? 0,
		);
		jest.spyOn(shippingService, 'computeOrderPayable').mockResolvedValue(
			prepaid?.payable ?? 0,
		);

		const updateStatus = jest
			.spyOn(orderService, 'updateStatus')
			.mockImplementation(async (entry, next) => {
				entry.status = next;

				return entry;
			});

		const result = await service.evaluate(order.id);

		return { result, updateStatus };
	};

	it('confirms a pending order once its documents are all paid', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.PENDING,
			state({ delivered: false }),
		);

		expect(result).toBe(OrderStatusEnum.CONFIRMED);
		expect(updateStatus).toHaveBeenCalledTimes(1);
	});

	// A digital order, or one whose goods arrived before the money: both steps at once
	it('confirms and completes a pending order already delivered', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.PENDING,
			state({}),
		);

		expect(result).toBe(OrderStatusEnum.COMPLETED);
		expect(updateStatus).toHaveBeenCalledTimes(2);
	});

	it('completes a confirmed order once delivered', async () => {
		const { result } = await run(OrderStatusEnum.CONFIRMED, state({}));

		expect(result).toBe(OrderStatusEnum.COMPLETED);
	});

	it('leaves an order with an unpaid document alone', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.PENDING,
			state({ all_paid: false }),
		);

		expect(result).toBeNull();
		expect(updateStatus).not.toHaveBeenCalled();
	});

	// Paid for what was billed, but something - a delivery fee, the rest of a partial
	// shipment - was never billed at all
	it('leaves an order that is not fully invoiced alone', async () => {
		const { result } = await run(
			OrderStatusEnum.PENDING,
			state({ fully_invoiced: false }),
		);

		expect(result).toBeNull();
	});

	// Not billed yet - a checkout since invoicing moved to confirmation
	it('confirms an unbilled pending order its captured payment covers', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.PENDING,
			state({ fully_invoiced: false, all_paid: false }),
			{ billed: false, paid: 120, payable: 120 },
		);

		expect(result).toBe(OrderStatusEnum.CONFIRMED);
		expect(updateStatus).toHaveBeenCalledTimes(1);
	});

	it('leaves an unbilled pending order its payment does not cover', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.PENDING,
			state({ fully_invoiced: false, all_paid: false }),
			{ billed: false, paid: 100, payable: 120 },
		);

		expect(result).toBeNull();
		expect(updateStatus).not.toHaveBeenCalled();
	});

	// Nobody paying for an order that costs nothing is not a payment
	it('leaves an unbilled pending order that costs nothing', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.PENDING,
			state({ fully_invoiced: false, all_paid: false }),
			{ billed: false, paid: 0, payable: 0 },
		);

		expect(result).toBeNull();
		expect(updateStatus).not.toHaveBeenCalled();
	});

	it('never moves a canceled order', async () => {
		const { result, updateStatus } = await run(
			OrderStatusEnum.CANCELLED,
			state({}),
		);

		expect(result).toBeNull();
		expect(updateStatus).not.toHaveBeenCalled();
	});
});
