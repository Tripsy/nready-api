import { expect, jest } from '@jest/globals';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	AMOUNT_DECIMALS,
	toGrossAmount,
} from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import {
	InvoicePaymentStatusEnum,
	resolvePaymentStatus,
} from '@/features/invoice/invoice.entity';
import { getInvoiceEntityMock } from '@/features/invoice/invoice.mock';
import { maxAllocatableAmount } from '@/features/invoice/invoice-payment.entity';
import { invoicePaymentService } from '@/features/invoice/invoice-payment.service';
import { setupTransactionMock } from '@/tests/jest-service.setup';

/** A movement's stored `amount`, from the money figure a person would quote. */
const scaled = (value: number): number =>
	Math.round(value * 10 ** AMOUNT_DECIMALS);

describe('toGrossAmount', () => {
	it('adds VAT to the net amount and lands on two decimals', () => {
		expect(toGrossAmount(scaled(100), 19)).toBe(119);
		expect(toGrossAmount(scaled(80.6452), 21)).toBe(97.58);
	});

	it('returns the net amount unchanged at a zero rate', () => {
		expect(toGrossAmount(scaled(49.99), 0)).toBe(49.99);
	});

	it('is unsigned - the direction of the movement is the caller business', () => {
		expect(toGrossAmount(scaled(50), 19)).toBeGreaterThan(0);
	});
});

describe('maxAllocatableAmount', () => {
	/*
	 * The regression this whole pass exists for: `cash_flow.amount` is net and scaled, so the raw
	 * column is nowhere near the ceiling an allocation may reach.
	 */
	it('is the gross worth, not the stored net amount', () => {
		const stored = scaled(100);

		expect(maxAllocatableAmount(stored, 19)).toBe(119);
		expect(maxAllocatableAmount(stored, 19)).not.toBe(stored);
	});
});

describe('resolvePaymentStatus', () => {
	it('is unpaid with nothing allocated', () => {
		expect(resolvePaymentStatus(119, 0)).toBe(
			InvoicePaymentStatusEnum.UNPAID,
		);
	});

	it('is partial while allocations fall short', () => {
		expect(resolvePaymentStatus(119, 50)).toBe(
			InvoicePaymentStatusEnum.PARTIAL,
		);
	});

	it('is paid once the total is met', () => {
		expect(resolvePaymentStatus(119, 119)).toBe(
			InvoicePaymentStatusEnum.PAID,
		);
	});

	/*
	 * A movement worth 97.5824 gross can only ever be allocated at 97.58, so an invoice it settles
	 * in full is short by sub-cent change no allocation can claim.
	 */
	it('is paid when only sub-cent change is left unallocated', () => {
		expect(resolvePaymentStatus(97.5824, 97.58)).toBe(
			InvoicePaymentStatusEnum.PAID,
		);
	});

	it('is partial when a whole cent is still owed', () => {
		expect(resolvePaymentStatus(119, 118.99)).toBe(
			InvoicePaymentStatusEnum.PARTIAL,
		);
	});

	it('reads an over-allocation as paid', () => {
		expect(resolvePaymentStatus(119, 130)).toBe(
			InvoicePaymentStatusEnum.PAID,
		);
	});
});

describe('InvoicePaymentService.settleClient', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	type Internals = {
		findOpenMovements: () => Promise<
			{ id: number; currency: string; available: number }[]
		>;
		getOutstanding: (
			manager: unknown,
			invoice: InvoiceEntity,
		) => Promise<number>;
		allocate: (
			manager: unknown,
			invoiceId: number,
			cashFlowId: number,
			amount: number,
		) => Promise<void>;
	};

	const internals = invoicePaymentService as unknown as Internals;

	/*
	 * Strict FIFO by client: the oldest money goes to the document falling due first, and what is
	 * left over moves on to the next - whatever order each was raised for.
	 */
	it('spreads the oldest money over the earliest documents first', async () => {
		const older = getInvoiceEntityMock({ id: 1, total_gross: 100 });
		const newer = getInvoiceEntityMock({ id: 2, total_gross: 100 });

		const { manager } = setupTransactionMock({
			createQueryBuilder: jest.fn(() => ({
				where: jest.fn().mockReturnThis(),
				andWhere: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				addOrderBy: jest.fn().mockReturnThis(),
				getMany: jest.fn(async () => [older, newer]),
			})),
		});

		jest.spyOn(internals, 'findOpenMovements').mockResolvedValue([
			{ id: 10, currency: 'RON', available: 60 },
			{ id: 11, currency: 'RON', available: 80 },
		]);
		jest.spyOn(internals, 'getOutstanding').mockResolvedValue(100);

		const allocate = jest
			.spyOn(internals, 'allocate')
			.mockResolvedValue(undefined);

		const { invoiceService } = await import(
			'@/features/invoice/invoice.service'
		);

		jest.spyOn(invoiceService, 'recomputePaymentStatus').mockImplementation(
			async (_manager, invoice) => {
				invoice.payment_status = InvoicePaymentStatusEnum.PAID;

				return invoice;
			},
		);

		const touched = await invoicePaymentService.settleClient(1);

		expect(manager.query).toHaveBeenCalledWith(
			'SELECT pg_advisory_xact_lock(hashtext($1), $2)',
			['invoice_payment.client', 1],
		);
		expect(allocate.mock.calls.map((call) => call.slice(1))).toEqual([
			[1, 10, 60],
			[1, 11, 40],
			[2, 11, 40],
		]);
		expect(touched.map((invoice) => invoice.id)).toEqual([1, 2]);
	});

	it('never settles a document in another currency', async () => {
		const document = getInvoiceEntityMock({
			id: 1,
			currency: 'EUR',
			total_gross: 100,
		});

		setupTransactionMock({
			createQueryBuilder: jest.fn(() => ({
				where: jest.fn().mockReturnThis(),
				andWhere: jest.fn().mockReturnThis(),
				orderBy: jest.fn().mockReturnThis(),
				addOrderBy: jest.fn().mockReturnThis(),
				getMany: jest.fn(async () => [document]),
			})),
		});

		jest.spyOn(internals, 'findOpenMovements').mockResolvedValue([
			{ id: 10, currency: 'RON', available: 500 },
		]);
		jest.spyOn(internals, 'getOutstanding').mockResolvedValue(100);

		const allocate = jest
			.spyOn(internals, 'allocate')
			.mockResolvedValue(undefined);

		const touched = await invoicePaymentService.settleClient(1);

		expect(allocate).not.toHaveBeenCalled();
		expect(touched).toEqual([]);
	});
});

describe('InvoicePaymentService allocation by hand', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	type Internals = {
		getOutstanding: (
			manager: unknown,
			invoice: InvoiceEntity,
		) => Promise<number>;
	};

	const internals = invoicePaymentService as unknown as Internals;

	const cashFlow = {
		id: 10,
		parent_id: null,
		status: 'completed',
		currency: 'RON',
		direction: 'in',
	} as unknown as CashFlowEntity;

	const payload = {
		id: 1,
		cash_flow_id: 10,
		amount: 50,
		notes: undefined,
	};

	// Money is the client's own: a movement filed under another client never settles this one
	it('create() refuses a movement of another client', async () => {
		const invoice = getInvoiceEntityMock({ client_id: 1 });

		jest.spyOn(cashFlowService, 'findById').mockResolvedValue(cashFlow);
		jest.spyOn(cashFlowService, 'findClientId').mockResolvedValue(2);
		const { transaction } = setupTransactionMock();

		await expect(
			invoicePaymentService.create(invoice, payload),
		).rejects.toThrow('invoice.error.payment_client_mismatch');
		expect(transaction).not.toHaveBeenCalled();
	});

	it('create() refuses more than the invoice still asks for', async () => {
		const invoice = getInvoiceEntityMock({ client_id: 1 });

		jest.spyOn(cashFlowService, 'findById').mockResolvedValue(cashFlow);
		jest.spyOn(cashFlowService, 'findClientId').mockResolvedValue(1);
		jest.spyOn(invoicePaymentService, 'getCeiling').mockResolvedValue({
			max: 500,
			allocated: 0,
			available: 500,
		});
		jest.spyOn(internals, 'getOutstanding').mockResolvedValue(20);
		setupTransactionMock();

		await expect(
			invoicePaymentService.create(invoice, payload),
		).rejects.toThrow('invoice.error.payment_amount_exceeds_outstanding');
	});

	// A reversal's allocations are refunds already paid out
	it('clear() refuses a reversal', async () => {
		const reversal = getInvoiceEntityMock({
			is_reversal: true,
			parent_invoice_id: 1,
		});

		await expect(
			(
				invoicePaymentService as unknown as {
					release: (
						invoice: InvoiceEntity,
						ids: number[],
					) => Promise<void>;
				}
			).release(reversal, [1]),
		).rejects.toThrow('invoice.error.payment_release_reversal');
	});

	// Money refunded against the original would otherwise become allocatable again
	it('clear() refuses an original with an issued reversal', async () => {
		const invoice = getInvoiceEntityMock();
		const { invoiceService } = await import(
			'@/features/invoice/invoice.service'
		);

		jest.spyOn(invoiceService, 'getReversedAmount').mockResolvedValue(30);
		const { manager } = setupTransactionMock();

		await expect(
			(
				invoicePaymentService as unknown as {
					release: (
						invoice: InvoiceEntity,
						ids: number[],
					) => Promise<void>;
				}
			).release(invoice, [1]),
		).rejects.toThrow('invoice.error.payment_release_reversed');
		expect(manager.getRepository).not.toHaveBeenCalled();
	});

	it('clear() removes the allocations and recomputes the status', async () => {
		const invoice = getInvoiceEntityMock();
		const { invoiceService } = await import(
			'@/features/invoice/invoice.service'
		);

		jest.spyOn(invoiceService, 'getReversedAmount').mockResolvedValue(0);
		const recompute = jest
			.spyOn(invoiceService, 'recomputePaymentStatus')
			.mockResolvedValue(invoice);
		const remove = jest.fn(async (_criteria: unknown) => ({ affected: 2 }));
		setupTransactionMock({ delete: remove });

		await (
			invoicePaymentService as unknown as {
				release: (
					invoice: InvoiceEntity,
					ids: number[],
				) => Promise<void>;
			}
		).release(invoice, [1, 2]);

		expect(remove).toHaveBeenCalledWith(
			expect.objectContaining({ invoice_id: invoice.id }),
		);
		expect(recompute).toHaveBeenCalled();
	});
});
