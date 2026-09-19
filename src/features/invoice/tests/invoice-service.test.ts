import { expect, jest } from '@jest/globals';
import type InvoiceEntity from '@/features/invoice/invoice.entity';
import {
	InvoicePaymentStatusEnum,
	InvoiceStatusEnum,
	InvoiceTypeEnum,
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
import type { InvoiceLineQuery } from '@/features/invoice/invoice-line.repository';
import type InvoicePaymentEntity from '@/features/invoice/invoice-payment.entity';
import type { InvoicePaymentQuery } from '@/features/invoice/invoice-payment.repository';
import {
	createMockRepository,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceUpdate,
} from '@/tests/jest-service.setup';

describe('InvoiceService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
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
		// A credit note only means anything next to the invoice it corrects, so it is raised
		// against that document rather than from an order id
		it('refuses a credit note', async () => {
			await expect(
				invoiceService.create({
					...invoiceOutputPayloads.create,
					type: InvoiceTypeEnum.CREDIT_NOTE,
				}),
			).rejects.toThrow('invoice.error.credit_note_needs_parent');
		});
	});

	describe('createCreditNote', () => {
		it('refuses a parent that is not a charge', async () => {
			const parent = getInvoiceEntityMock({
				type: InvoiceTypeEnum.PROFORMA,
			});

			await expect(
				invoiceService.createCreditNote(parent, {
					id: parent.id,
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.credit_note_parent_type');
		});

		it('refuses a parent that has not been issued', async () => {
			const parent = getInvoiceEntityMock({
				status: InvoiceStatusEnum.DRAFT,
			});

			await expect(
				invoiceService.createCreditNote(parent, {
					id: parent.id,
					notes: undefined,
				}),
			).rejects.toThrow('invoice.error.credit_note_parent_status');
		});
	});

	describe('cancel', () => {
		/*
		 * Money has moved for a settled document, and taking it back is a credit note plus its
		 * own movement - so the allocations refuse the cancellation, not the status alone.
		 */
		it('refuses a document with allocations against it', async () => {
			mockPayment.query.count.mockResolvedValue(1);

			await expect(
				invoiceService.cancel(getInvoiceEntityMock()),
			).rejects.toThrow('invoice.error.cancel_settled');
		});

		it('cancels an unsettled document', async () => {
			const entry = getInvoiceEntityMock();

			mockPayment.query.count.mockResolvedValue(0);
			mockInvoice.repository.save.mockResolvedValue(entry);

			await invoiceService.cancel(entry);

			expect(entry.status).toBe(InvoiceStatusEnum.CANCELLED);
			expect(mockInvoice.repository.save).toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('refuses anything but a draft', async () => {
			mockInvoice.query.firstOrFail.mockResolvedValue(
				getInvoiceEntityMock({ status: InvoiceStatusEnum.ISSUED }),
			);

			await expect(invoiceService.delete(1)).rejects.toThrow(
				'invoice.error.delete_not_allowed',
			);
		});

		it('deletes a draft', async () => {
			mockInvoice.query.firstOrFail.mockResolvedValue(
				getInvoiceEntityMock({ status: InvoiceStatusEnum.DRAFT }),
			);
			mockInvoice.query.delete.mockResolvedValue(1);

			await invoiceService.delete(1);

			expect(mockInvoice.query.filterById).toHaveBeenCalledWith(1);
			expect(mockInvoice.query.delete).toHaveBeenCalled();
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

		it('routes anything else through cancel', async () => {
			const entry = getInvoiceEntityMock({
				status: InvoiceStatusEnum.ISSUED,
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

	describe('getEntryData', () => {
		it('returns the document with its lines and allocations', async () => {
			const entry = getInvoiceEntityMock();
			const lines = [getInvoiceLineEntityMock()];

			mockInvoice.query.firstOrFail.mockResolvedValue(entry);
			mockLine.query.all.mockResolvedValue(
				lines as unknown as [InvoiceLineEntity[], number],
			);
			mockPayment.query.all.mockResolvedValue(
				[] as unknown as [InvoicePaymentEntity[], number],
			);

			const result = await invoiceService.getEntryData({
				id: entry.id,
				withDeleted: false,
			});

			expect(result.id).toBe(entry.id);
			expect(result.lines).toBe(lines);
			expect(result.payments).toEqual([]);
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
