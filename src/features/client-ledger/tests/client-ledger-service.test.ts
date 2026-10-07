import { expect, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import {
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import {
	type LedgerMovement,
	recordLedgerMovement,
	registerClientLedgerRecorder,
} from '@/features/cash-flow/cash-flow.hooks';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import registerClientLedgerBootstrap from '@/features/client-ledger/client-ledger.bootstrap';
import { ClientLedgerEntryTypeEnum } from '@/features/client-ledger/client-ledger.entity';
import { clientLedgerService } from '@/features/client-ledger/client-ledger.service';

describe('client ledger', () => {
	const movement = (
		overrides: Partial<LedgerMovement> = {},
	): LedgerMovement => ({
		id: 9,
		parent_id: null,
		status: CashFlowStatusEnum.COMPLETED,
		direction: CashFlowDirectionEnum.IN,
		amount: 1000 * 10 ** 4,
		vat_rate: 21,
		currency: 'RON',
		exchange_rate: 1,
		updated_at: new Date('2026-10-07T00:00:00Z'),
		...overrides,
	});

	/** A manager whose insert chain records the row it was asked to write. */
	const arrange = (clientId: number | null) => {
		const values = jest.fn((_row: unknown) => ({
			orIgnore: () => ({ execute: jest.fn(async () => undefined) }),
		}));

		jest.spyOn(cashFlowService, 'findClientId').mockResolvedValue(clientId);

		return {
			manager: {
				createQueryBuilder: jest.fn(() => ({
					insert: () => ({ into: () => ({ values: values }) }),
				})),
			} as unknown as EntityManager,
			values: values,
		};
	};

	beforeEach(() => {
		jest.restoreAllMocks();
		registerClientLedgerRecorder(null);
	});

	// Optional: with the feature absent, money moves the same and no ledger is kept
	it('does nothing when no recorder is registered', async () => {
		await expect(
			recordLedgerMovement({} as EntityManager, movement()),
		).resolves.toBeUndefined();
	});

	// The bootstrap is what installs the feature into the completion `cash-flow` runs
	it('routes the registry call to the ledger service once bootstrapped', async () => {
		const recordCashFlow = jest
			.spyOn(clientLedgerService, 'recordCashFlow')
			.mockResolvedValue();
		const manager = {} as EntityManager;

		registerClientLedgerBootstrap();

		await recordLedgerMovement(manager, movement());

		expect(recordCashFlow).toHaveBeenCalledWith(movement(), manager);
	});

	describe('recordCashFlow', () => {
		// Money received from the client is positive, at the gross of the movement
		it('books money in as a positive payment', async () => {
			const { manager, values } = arrange(5);

			await clientLedgerService.recordCashFlow(movement(), manager);

			expect(values).toHaveBeenCalledWith(
				expect.objectContaining({
					client_id: 5,
					entry_type: ClientLedgerEntryTypeEnum.PAYMENT,
					cash_flow_id: 9,
					amount: 1210,
					amount_base: 1210,
				}),
			);
		});

		// Money paid back is negative; a refund names its parent's client, which `cash-flow` resolves
		it('books money out as a negative refund', async () => {
			const { manager, values } = arrange(5);

			await clientLedgerService.recordCashFlow(
				movement({
					direction: CashFlowDirectionEnum.OUT,
					parent_id: 3,
				}),
				manager,
			);

			expect(values).toHaveBeenCalledWith(
				expect.objectContaining({
					entry_type: ClientLedgerEntryTypeEnum.REFUND,
					amount: -1210,
				}),
			);
		});

		// Only money that moved: not yet captured, not a client's, or worth nothing
		it('books nothing for a movement not completed, not a client one, or worth nothing', async () => {
			const pending = arrange(5);

			await clientLedgerService.recordCashFlow(
				movement({ status: CashFlowStatusEnum.PENDING }),
				pending.manager,
			);

			const vendor = arrange(null);

			await clientLedgerService.recordCashFlow(
				movement(),
				vendor.manager,
			);

			const zero = arrange(5);

			await clientLedgerService.recordCashFlow(
				movement({ amount: 10 }),
				zero.manager,
			);

			expect(pending.values).not.toHaveBeenCalled();
			expect(vendor.values).not.toHaveBeenCalled();
			expect(zero.values).not.toHaveBeenCalled();
		});
	});
});
