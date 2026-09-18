import {
	AMOUNT_DECIMALS,
	toGrossAmount,
} from '@/features/cash-flow/cash-flow.entity';
import {
	InvoicePaymentStatusEnum,
	resolvePaymentStatus,
} from '@/features/invoice/invoice.entity';
import { maxAllocatableAmount } from '@/features/invoice/invoice-payment.entity';

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
