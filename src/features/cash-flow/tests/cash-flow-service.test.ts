import { expect, jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import { Configuration } from '@/config/settings.config';
import { BadRequestError } from '@/exceptions';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	CashFlowCategoryTypeEnum,
	CashFlowDirectionEnum,
	type CashFlowStatus,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import {
	cashFlowInputPayloads,
	cashFlowOutputPayloads,
	getCashFlowEntityMock,
} from '@/features/cash-flow/cash-flow.mock';
import type {
	CashFlowQuery,
	getCashFlowRepository,
} from '@/features/cash-flow/cash-flow.repository';
import { CashFlowService } from '@/features/cash-flow/cash-flow.service';
import type { CashFlowValidator } from '@/features/cash-flow/cash-flow.validator';
import { CashFlowCategoryEnum } from '@/features/cash-flow/cash-flow-category.enum';
import {
	type CashFlowSettledPayload,
	registerCashFlowSettledHandler,
} from '@/shared/registries/order-settlement.registry';
import {
	createMockRepository,
	setupTransactionMock,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceUpdateStatus,
} from '@/tests/jest-service.setup';

describe('CashFlowService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockCashFlow = createMockRepository<CashFlowEntity, CashFlowQuery>();

	(
		mockCashFlow.repository as unknown as {
			setupOperationalRecord: jest.Mock;
		}
	).setupOperationalRecord = jest.fn();

	const serviceCashFlow = new CashFlowService(
		mockCashFlow.repository as unknown as ReturnType<
			typeof getCashFlowRepository
		>,
	);

	it('checkDirection - should NOT throw when direction is IN', async () => {
		expect(() =>
			serviceCashFlow.checkDirection(
				CashFlowCategoryTypeEnum.REVENUE,
				CashFlowDirectionEnum.IN,
			),
		).not.toThrow();
	});

	it('checkDirection - should throw when direction is OUT', async () => {
		expect(() =>
			serviceCashFlow.checkDirection(
				CashFlowCategoryTypeEnum.REVENUE,
				CashFlowDirectionEnum.OUT,
			),
		).toThrow(BadRequestError);
	});

	it('checkCategoryType - should NOT throw when category belongs to proper category_type', async () => {
		expect(() =>
			serviceCashFlow.checkCategoryType(
				CashFlowCategoryTypeEnum.REVENUE,
				CashFlowCategoryEnum.SALE,
			),
		).not.toThrow(BadRequestError);
	});

	it('checkCategoryType - should throw when category not assigned to proper category_type', async () => {
		expect(() =>
			serviceCashFlow.checkCategoryType(
				CashFlowCategoryTypeEnum.EXPENSE,
				CashFlowCategoryEnum.SALE,
			),
		).toThrow();
	});

	it('checkCategory - should throw when parent_id is not present', async () => {
		expect(() =>
			serviceCashFlow.checkCategory(
				CashFlowCategoryEnum.REFUND,
				undefined,
			),
		).toThrow(BadRequestError);
	});

	it('checkRefund - should throw when invalid category is set', async () => {
		await expect(() =>
			serviceCashFlow.checkRefund({
				category: CashFlowCategoryEnum.SALE,
				inputAmount: 2500,
				currency: Configuration.currency(),
				parentEntry: getCashFlowEntityMock(),
				refundedAmount: 10000,
			}),
		).rejects.toThrow('cash-flow.validation.invalid_category');
	});

	it('checkRefund - should throw when parent status is not appropriate', async () => {
		await expect(() =>
			serviceCashFlow.checkRefund({
				category: CashFlowCategoryEnum.REFUND,
				inputAmount: 2500,
				currency: Configuration.currency(),
				parentEntry: getCashFlowEntityMock({
					status: CashFlowStatusEnum.CANCELED,
				}),
				refundedAmount: 10000,
			}),
		).rejects.toThrow('cash-flow.error.invalid_refund_parent_status');
	});

	it('checkRefund - should throw when currency is not matching', async () => {
		await expect(() =>
			serviceCashFlow.checkRefund({
				category: CashFlowCategoryEnum.REFUND,
				inputAmount: 2500,
				currency: Configuration.currency(),
				parentEntry: getCashFlowEntityMock({
					currency: 'EUR',
				}),
				refundedAmount: 10000,
			}),
		).rejects.toThrow('cash-flow.error.refund_parent_same_currency');
	});

	it('checkRefund - should throw when parent category type is CORRECTION', async () => {
		await expect(() =>
			serviceCashFlow.checkRefund({
				category: CashFlowCategoryEnum.REFUND,
				inputAmount: 2500,
				currency: Configuration.currency(),
				parentEntry: getCashFlowEntityMock({
					category_type: CashFlowCategoryTypeEnum.CORRECTION,
				}),
				refundedAmount: 10000,
			}),
		).rejects.toThrow(
			'cash-flow.error.refund_parent_invalid_category_type',
		);
	});

	it('checkRefund - should throw when parent amount is smaller than amount', async () => {
		await expect(() =>
			serviceCashFlow.checkRefund({
				category: CashFlowCategoryEnum.REFUND,
				inputAmount: 2500,
				currency: Configuration.currency(),
				parentEntry: getCashFlowEntityMock({
					amount: 1000,
				}),
				refundedAmount: 10000,
			}),
		).rejects.toThrow('cash-flow.error.refund_amount_mismatch');
	});

	it('checkRefund - should throw when amount is bigger than refundable amount left', async () => {
		await expect(() =>
			serviceCashFlow.checkRefund({
				category: CashFlowCategoryEnum.REFUND,
				inputAmount: 2500,
				currency: Configuration.currency(),
				parentEntry: getCashFlowEntityMock({
					amount: 12000,
				}),
				refundedAmount: 10000,
			}),
		).rejects.toThrow('cash-flow.error.refund_amount_mismatch');
	});

	it('getExchangeRate - should return 1 for default currency', async () => {
		const result = await serviceCashFlow.getExchangeRate(
			Configuration.currency(),
		);

		expect(result).toBe(1);
	});

	// The refund and the entry it reverses are the same money in the same currency, so the
	// rate comes from the parent rather than from whatever is published today
	it('getExchangeRate - should inherit the rate of a refunded entry', async () => {
		const result = await serviceCashFlow.getExchangeRate(
			'EUR',
			getCashFlowEntityMock({
				currency: 'EUR',
				exchange_rate: 4.9712,
			}),
		);

		expect(result).toBe(4.9712);
	});

	it('should create entry - refund', async () => {
		const entity = getCashFlowEntityMock({
			category: CashFlowCategoryEnum.REFUND,
			parent_id: 1,
		});

		const createData = cashFlowOutputPayloads.create;

		const { manager } = setupTransactionMock();
		(manager.getRepository as jest.Mock).mockReturnValue(
			mockCashFlow.repository,
		);

		jest.spyOn(serviceCashFlow, 'checkDirection').mockImplementationOnce(
			() => null,
		);
		jest.spyOn(serviceCashFlow, 'checkCategoryType').mockImplementationOnce(
			() => null,
		);
		jest.spyOn(serviceCashFlow, 'checkCategory').mockImplementationOnce(
			() => null,
		);
		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(
			getCashFlowEntityMock(),
		);
		jest.spyOn(serviceCashFlow, 'checkRefund').mockImplementationOnce(
			async () => {},
		);

		mockCashFlow.repository.save.mockResolvedValue(entity);

		const result = await serviceCashFlow.create(createData);

		expect(mockCashFlow.repository.save).toHaveBeenCalled();
		expect(result).toBe(entity);
	});

	it('on updateData throw error when updating entry with wrong status', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.COMPLETED,
		});

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);

		await expect(
			serviceCashFlow.updateData(entry, {
				...cashFlowInputPayloads.update,
			}),
		).rejects.toThrow('cash-flow.error.update_not_allowed');
	});

	it('should call save with merged data when status is mutable', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});
		const payload = { ...cashFlowInputPayloads.update };

		const { manager } = setupTransactionMock();
		(manager.getRepository as jest.Mock).mockReturnValue(
			mockCashFlow.repository,
		);

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);

		const expectedAmount = serviceCashFlow.inputAmount(payload.amount);

		mockCashFlow.repository.save.mockImplementation(async (data) => data);

		const result = await serviceCashFlow.updateData(entry, payload);

		expect(mockCashFlow.repository.save).toHaveBeenCalledWith(
			expect.objectContaining({ ...payload, amount: expectedAmount }),
		);
		expect(result).toEqual({
			...entry,
			...payload,
			amount: expectedAmount,
		});
	});

	testServiceUpdateStatus<CashFlowEntity, CashFlowStatus>(
		serviceCashFlow,
		mockCashFlow.repository as unknown as jest.MockedObject<
			Repository<CashFlowEntity>
		>,
		{
			good: {
				from: CashFlowStatusEnum.PENDING,
				to: CashFlowStatusEnum.AUTHORIZED,
			},
			bad: {
				from: CashFlowStatusEnum.COMPLETED,
				to: CashFlowStatusEnum.EXPIRED,
			},
		},
	);

	it('should update status with success', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);

		// Capture is the one transition that looks for an order to settle. Nothing is registered
		// with `order-settlement.registry.ts` here - `bootstrap.setup.ts` is skipped in the test
		// environment - so the lookup is all there is to stub
		jest.spyOn(serviceCashFlow, 'findOrderId').mockResolvedValue(null);

		mockCashFlow.repository.save.mockResolvedValue(entry);

		await serviceCashFlow.updateStatus(entry, CashFlowStatusEnum.COMPLETED);

		expect(mockCashFlow.repository.save).toHaveBeenCalled();
	});

	/*
	 * The handover the shop's happy path runs on: a captured payment is what confirms the order it
	 * was raised for. What the handler does with it is `order`'s to test - this covers that the
	 * ledger announces it, and only for the transition that moved money.
	 */
	it('announces a captured payment to the order it was raised for', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		const settled = jest
			.fn<(payload: CashFlowSettledPayload) => Promise<void>>()
			.mockResolvedValue();

		registerCashFlowSettledHandler(settled);

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);
		jest.spyOn(serviceCashFlow, 'findOrderId').mockResolvedValue(42);

		mockCashFlow.repository.save.mockResolvedValue(entry);

		await serviceCashFlow.updateStatus(entry, CashFlowStatusEnum.COMPLETED);

		expect(settled).toHaveBeenCalledWith({
			cash_flow_id: entry.id,
			order_id: 42,
		});
	});

	it('announces nothing when a payment is canceled rather than captured', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		const settled = jest
			.fn<(payload: CashFlowSettledPayload) => Promise<void>>()
			.mockResolvedValue();

		registerCashFlowSettledHandler(settled);

		const findOrderId = jest.spyOn(serviceCashFlow, 'findOrderId');

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);

		mockCashFlow.repository.save.mockResolvedValue(entry);

		await serviceCashFlow.updateStatus(entry, CashFlowStatusEnum.CANCELED);

		expect(findOrderId).not.toHaveBeenCalled();
		expect(settled).not.toHaveBeenCalled();
	});

	it('should delete by id', async () => {
		const entity = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		mockCashFlow.query.first.mockResolvedValue(entity);
		mockCashFlow.query.delete.mockResolvedValue(1);

		await serviceCashFlow.delete(1, false);

		expect(mockCashFlow.query.delete).toHaveBeenCalledWith();
	});

	testServiceFindById<CashFlowEntity, CashFlowQuery>(
		mockCashFlow.query,
		serviceCashFlow,
	);

	testServiceFindByFilter<CashFlowEntity, CashFlowQuery, CashFlowValidator>(
		mockCashFlow.query,
		serviceCashFlow,
		cashFlowOutputPayloads.find,
	);
});
