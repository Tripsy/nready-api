import { QueryFailedError } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import InvoiceEntity, {
	InvoiceStatusEnum,
	InvoiceTypeEnum,
} from '@/features/invoice/invoice.entity';
import { invoiceService } from '@/features/invoice/invoice.service';
import type { InvoiceValidator } from '@/features/invoice/invoice.validator';
import InvoicePaymentEntity, {
	maxAllocatableAmount,
} from '@/features/invoice/invoice-payment.entity';
import { getInvoicePaymentRepository } from '@/features/invoice/invoice-payment.repository';
import { roundMoney } from '@/helpers/shop.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * How far a movement has already been spent, and what is left of it.
 *
 * The ceiling is the movement's **gross** worth - `maxAllocatableAmount`, never `cash_flow.amount`,
 * which is net and scaled by four decimals.
 */
export type AllocationCeiling = {
	max: number;
	allocated: number;
	available: number;
};

export class InvoicePaymentService {
	constructor(
		private repository: ReturnType<typeof getInvoicePaymentRepository>,
	) {}

	/**
	 * What is left of a movement to hand out. Allocations against one movement may span several
	 * invoices - a single transfer from a company client clears a handful - so the ceiling is
	 * what the movement is worth minus what it has already settled elsewhere.
	 */
	public async getCeiling(
		cashFlow: CashFlowEntity,
	): Promise<AllocationCeiling> {
		const result = await this.repository
			.createQuery()
			.select(['SUM(invoice_payment.amount) AS total'], false)
			.filterBy('cash_flow_id', cashFlow.id)
			.firstRaw();

		const max = maxAllocatableAmount(
			Number(cashFlow.amount),
			Number(cashFlow.vat_rate),
		);

		const allocated = roundMoney(Number(result?.total ?? 0));

		return {
			max: max,
			allocated: allocated,
			available: roundMoney(max - allocated),
		};
	}

	/**
	 * @description Used in `paymentCreate` method from controller
	 *
	 * Settles part or all of an invoice against a cash movement, then re-reads where the document
	 * stands. Both writes share one transaction: a `payment_status` that disagrees with the
	 * allocations it was computed from is what dunning would chase a settled buyer over.
	 *
	 * The currency check is not a formality - `invoice.currency` and `cash_flow.currency` are
	 * separate columns with no constraint tying them, and neither row carries a rate for the
	 * other's date, so an allocation across two currencies would be a figure nobody can defend.
	 */
	public async create(
		invoice: InvoiceEntity,
		data: ValidatorOutput<InvoiceValidator, 'paymentCreate'>,
	): Promise<InvoicePaymentEntity> {
		if (invoice.status !== InvoiceStatusEnum.ISSUED) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_invoice_status'),
			);
		}

		const cashFlow = await cashFlowService.findById(
			data.cash_flow_id,
			false,
		);

		if (cashFlow.status !== CashFlowStatusEnum.COMPLETED) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_cash_flow_status', {
					status: CashFlowStatusEnum.COMPLETED,
				}),
			);
		}

		if (cashFlow.currency !== invoice.currency) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_currency_mismatch', {
					invoice_currency: invoice.currency,
					cash_flow_currency: cashFlow.currency,
				}),
			);
		}

		/*
		 * A charge is settled by money coming in and a credit note by money going back out, so
		 * the movement's direction has to match the document it is allocated against - otherwise
		 * a refund would read as a payment and settle the very invoice it reverses.
		 */
		const expectedDirection =
			invoice.type === InvoiceTypeEnum.CREDIT_NOTE
				? CashFlowDirectionEnum.OUT
				: CashFlowDirectionEnum.IN;

		if (cashFlow.direction !== expectedDirection) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_direction_mismatch', {
					direction: expectedDirection,
				}),
			);
		}

		const ceiling = await this.getCeiling(cashFlow);

		if (data.amount > ceiling.available) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_amount_exceeds_available', {
					available: ceiling.available.toFixed(2),
				}),
			);
		}

		const entry = await dataSource
			.transaction(async (manager) => {
				const saved = await manager
					.getRepository(InvoicePaymentEntity)
					.save(
						manager.create(InvoicePaymentEntity, {
							invoice_id: invoice.id,
							cash_flow_id: cashFlow.id,
							amount: data.amount,
							notes: data.notes ?? null,
						}),
					);

				await invoiceService.recomputePaymentStatus(manager, invoice);

				return saved;
			})
			.catch((error: unknown) => {
				throw this.asConflict(error);
			});

		await cleanEntityCache(InvoiceEntity, invoice.id);

		return entry;
	}

	/**
	 * @description Used by the order-confirmed handler in `invoice.bootstrap.ts` and by
	 * `raiseForCashFlow` in the controller; allocates a captured movement against a charge just
	 * raised from it
	 *
	 * The figure is the smaller of what the document asks for and what the movement has left to
	 * give, so the two ordinary mismatches both land somewhere defensible: a buyer who paid more
	 * than the order came to leaves the surplus unallocated, for a refund or a later document, and
	 * one who paid less leaves the invoice `partial` for dunning to chase. Allocating the full
	 * `total_gross` regardless would be refused outright by the ceiling check in `create` and
	 * settle nothing at all.
	 *
	 * Does nothing when the movement is already spent, or when it has not been captured yet. The
	 * caller is settling on the strength of having just raised a document, not on the movement
	 * having anything to give - an order invoiced up front is charged before its payment lands,
	 * and the document simply stands `unpaid` until the capture announces itself and comes back
	 * through here. `create` would refuse both cases outright, which would mean answering a
	 * request whose document is already issued and committed with a 409.
	 */
	public async settleFromCashFlow(
		invoice: InvoiceEntity,
		cashFlowId: number,
	): Promise<void> {
		const cashFlow = await cashFlowService.findById(cashFlowId, false);

		if (cashFlow.status !== CashFlowStatusEnum.COMPLETED) {
			return;
		}

		const ceiling = await this.getCeiling(cashFlow);

		const amount = roundMoney(
			Math.min(ceiling.available, Number(invoice.total_gross)),
		);

		if (amount <= 0) {
			return;
		}

		await this.create(invoice, {
			id: invoice.id,
			cash_flow_id: cashFlowId,
			amount: amount,
			notes: undefined,
		});
	}

	/**
	 * @description Used in `paymentDelete` method from controller
	 *
	 * A hard delete: the pair is unique over live rows only, so a soft-deleted allocation would
	 * hold the index and block ever allocating that movement to this invoice again - the same
	 * reason `account_identity` unlinks hard.
	 */
	public async delete(invoice: InvoiceEntity, paymentId: number) {
		const entry = await this.repository
			.createQuery()
			.filterById(paymentId)
			.filterBy('invoice_id', invoice.id)
			.first();

		if (!entry) {
			throw new CustomError(404, lang('invoice.error.payment_not_found'));
		}

		await dataSource.transaction(async (manager) => {
			await manager
				.getRepository(InvoicePaymentEntity)
				.delete({ id: entry.id });

			await invoiceService.recomputePaymentStatus(manager, invoice);
		});

		await cleanEntityCache(InvoiceEntity, invoice.id);
	}

	/**
	 * `IDX_invoice_payment_pair` is the only unique on the table: this movement already settles
	 * this invoice. Raising the figure is an edit of that allocation, not a second one, so the
	 * caller is told which row is in the way rather than being handed a masked 500.
	 *
	 * Anything that is not a unique violation is returned untouched, so the original error keeps
	 * its stack and reaches the error handler as itself.
	 */
	private asConflict(error: unknown): unknown {
		if (
			!(error instanceof QueryFailedError) ||
			!RepositoryAbstract.isUniqueViolation(error)
		) {
			return error;
		}

		return new CustomError(409, lang('invoice.error.payment_duplicate'));
	}
}

export const invoicePaymentService = new InvoicePaymentService(
	getInvoicePaymentRepository(),
);
