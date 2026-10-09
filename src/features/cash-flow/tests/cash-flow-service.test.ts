import { expect, jest } from '@jest/globals';
import type { EntityManager, Repository } from 'typeorm';
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
	type CashFlowCompletedPayload,
	type LedgerMovement,
	registerCashFlowCompletedHandler,
	registerClientLedgerRecorder,
} from '@/features/cash-flow/cash-flow.hooks';
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
import type { ValidatorOutput } from '@/shared/types/mock.type';
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

	// A refund is filed under its parent's client and order - inherited, whatever it is handed
	it('createWithin - a refund takes its parent records', async () => {
		const parent = getCashFlowEntityMock();
		const records = [
			{ operational_record_type: 'client', entity_id: 5 },
			{ operational_record_type: 'order', entity_id: 7 },
		];

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(parent);
		jest.spyOn(serviceCashFlow, 'getRefundedAmountSum').mockResolvedValue(
			0,
		);
		jest.spyOn(serviceCashFlow, 'checkRefund').mockResolvedValue();
		jest.spyOn(
			serviceCashFlow as unknown as {
				getExchangeRate: () => Promise<number>;
			},
			'getExchangeRate',
		).mockResolvedValue(1);

		const manager = {
			getRepository: jest.fn(() => ({
				save: jest.fn(async (entry: object) => ({ ...entry, id: 99 })),
				find: jest.fn(async () => records),
			})),
		} as unknown as EntityManager;

		const setup = (
			mockCashFlow.repository as unknown as {
				setupOperationalRecord: jest.Mock;
			}
		).setupOperationalRecord;
		setup.mockClear();

		await serviceCashFlow.createWithin(manager, {
			...cashFlowOutputPayloads.create,
			direction: CashFlowDirectionEnum.OUT,
			category_type: CashFlowCategoryTypeEnum.CORRECTION,
			category: CashFlowCategoryEnum.REFUND,
			currency: parent.currency,
			parent_id: parent.id,
			operational_records: { vendor: 3 },
		} as ValidatorOutput<CashFlowValidator, 'create'>);

		expect(setup).toHaveBeenCalledTimes(2);
		expect(setup).toHaveBeenCalledWith(manager, {
			cash_flow_id: 99,
			operational_record_type: 'client',
			entity_id: 5,
		});
		expect(setup).toHaveBeenCalledWith(manager, {
			cash_flow_id: 99,
			operational_record_type: 'order',
			entity_id: 7,
		});
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

		// Capture is the one transition that is announced. Nothing is registered with
		// `cash-flow.hooks.ts` here - `bootstrap.setup.ts` is skipped in the test
		// environment - so the announcement goes nowhere
		const save = jest.fn(async (row: unknown) => row);

		setupTransactionMock({ save: save });

		await serviceCashFlow.updateStatus(entry, CashFlowStatusEnum.COMPLETED);

		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ status: CashFlowStatusEnum.COMPLETED }),
		);
	});

	/*
	 * The ledger is the money that moved, and completion is the moment it moved: the entry is
	 * booked through the registry with the completing transaction's own manager, so neither can
	 * commit without the other.
	 */
	it('books a captured movement on the client ledger inside its transaction', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		const { manager } = setupTransactionMock({
			save: jest.fn(async (row: unknown) => row),
		});
		const recorder = jest.fn(
			async (_manager: EntityManager, _movement: LedgerMovement) => {},
		);

		registerClientLedgerRecorder(recorder);

		try {
			await serviceCashFlow.updateStatus(
				entry,
				CashFlowStatusEnum.COMPLETED,
			);
		} finally {
			registerClientLedgerRecorder(null);
		}

		expect(recorder).toHaveBeenCalledWith(
			manager as unknown as EntityManager,
			expect.objectContaining({
				id: entry.id,
				status: CashFlowStatusEnum.COMPLETED,
			}),
		);
	});

	/*
	 * The handover the settlement chain runs on: a captured payment goes on the client's ledger
	 * and is allocated to their open documents. What the handler does with it is `invoice`'s to
	 * test - this covers that the ledger announces every capture, whatever it was raised for, and
	 * only the transition that moved money.
	 */
	it('announces a captured payment', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		const completed = jest
			.fn<(payload: CashFlowCompletedPayload) => Promise<void>>()
			.mockResolvedValue();

		registerCashFlowCompletedHandler(completed);

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);

		setupTransactionMock({ save: jest.fn(async (row: unknown) => row) });

		await serviceCashFlow.updateStatus(entry, CashFlowStatusEnum.COMPLETED);

		expect(completed).toHaveBeenCalledWith({
			cash_flow_id: entry.id,
		});
	});

	it('announces nothing when a payment is canceled rather than captured', async () => {
		const entry = getCashFlowEntityMock({
			status: CashFlowStatusEnum.PENDING,
		});

		const completed = jest
			.fn<(payload: CashFlowCompletedPayload) => Promise<void>>()
			.mockResolvedValue();

		registerCashFlowCompletedHandler(completed);

		jest.spyOn(serviceCashFlow, 'findById').mockResolvedValue(entry);

		mockCashFlow.repository.save.mockResolvedValue(entry);

		await serviceCashFlow.updateStatus(entry, CashFlowStatusEnum.CANCELED);

		expect(completed).not.toHaveBeenCalled();
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

describe('CashFlowService.restatePendingForOrder', () => {
	const service = new CashFlowService(
		createMockRepository<CashFlowEntity, CashFlowQuery>()
			.repository as unknown as ReturnType<typeof getCashFlowRepository>,
	);

	/**
	 * A manager whose movement reads return `rows`, recording the lock the read asked for, and
	 * where the lock sat relative to running the read.
	 */
	const managerReturning = (rows: CashFlowEntity[]) => {
		const calls: string[] = [];
		const builder = {
			innerJoin: jest.fn(() => builder),
			where: jest.fn(() => builder),
			orderBy: jest.fn(() => builder),
			setLock: jest.fn(() => {
				calls.push('setLock');

				return builder;
			}),
			getMany: jest.fn(async () => {
				calls.push('getMany');

				return rows;
			}),
		};
		const update = jest.fn(async () => ({}));

		const manager = {
			getRepository: jest.fn(() => ({
				createQueryBuilder: jest.fn(() => builder),
				update: update,
			})),
		} as unknown as EntityManager;

		return { manager, builder, update, calls };
	};

	beforeEach(() => {
		jest.restoreAllMocks();
	});

	// A gateway callback racing the edit has to wait for the restated amount, or land first
	it('locks the pending request before restating it', async () => {
		const request = getCashFlowEntityMock({
			id: 7,
			status: CashFlowStatusEnum.PENDING,
			vat_rate: 0,
		});
		const { manager, builder, update, calls } = managerReturning([request]);

		await expect(
			service.restatePendingForOrder(manager, 1, 150),
		).resolves.toBe(7);

		expect(builder.setLock).toHaveBeenCalledWith(
			'pessimistic_write',
			undefined,
			['cash_flow'],
		);
		expect(calls).toEqual(['setLock', 'getMany']);
		expect(update).toHaveBeenCalledWith(7, {
			amount: service.inputAmount(150),
		});
	});

	// The callback committed first: the request is no longer pending and keeps its amount
	it('moves nothing when no request is still pending under the lock', async () => {
		const { manager, update } = managerReturning([]);

		await expect(
			service.restatePendingForOrder(manager, 1, 150),
		).resolves.toBeNull();

		expect(update).not.toHaveBeenCalled();
	});
});
