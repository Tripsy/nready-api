import { type EntityManager, In, QueryFailedError } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { OperationalRecordTypeEnum } from '@/features/cash-flow/operational-record.entity';
import InvoiceEntity, {
	InvoicePaymentStatusEnum,
	InvoiceStatusEnum,
	PAYMENT_SETTLED_TOLERANCE,
} from '@/features/invoice/invoice.entity';
import { invoiceService } from '@/features/invoice/invoice.service';
import type { InvoiceValidator } from '@/features/invoice/invoice.validator';
import InvoicePaymentEntity, {
	maxAllocatableAmount,
} from '@/features/invoice/invoice-payment.entity';
import { getInvoicePaymentRepository } from '@/features/invoice/invoice-payment.repository';
import { roundMoney } from '@/helpers/shop.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
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

/** A captured movement with something left to allocate, in its own currency. */
type OpenMovement = {
	id: number;
	currency: string;
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
		manager: EntityManager = dataSource.manager,
	): Promise<AllocationCeiling> {
		const result = await manager
			.getRepository(InvoicePaymentEntity)
			.createQueryBuilder('invoice_payment')
			.select('COALESCE(SUM(invoice_payment.amount), 0)', 'total')
			.where('invoice_payment.cash_flow_id = :cash_flow_id', {
				cash_flow_id: cashFlow.id,
			})
			.getRawOne<{ total: string }>();

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
	 * Money stays with its client: the movement must be filed under the invoice's own client (a
	 * refund under its parent's), so a manual allocation never moves money between clients.
	 *
	 * Capped twice, under the client's lock so a concurrent capture cannot read the same open
	 * figures: by what is left of the movement, and by what the document still asks for - an
	 * over-allocated document would hold money no other document of the client can reach.
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
		 * An original is settled by money coming in and a reversal by money going back out, so
		 * the movement's direction has to match the document it is allocated against - otherwise
		 * a refund would read as a payment and settle the very invoice it reverses.
		 */
		const expectedDirection = invoice.is_reversal
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

		const clientId = await cashFlowService.findClientId(cashFlow);

		if (clientId !== invoice.client_id) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_client_mismatch'),
			);
		}

		const entry = await dataSource
			.transaction(async (manager) => {
				await this.lockClient(manager, invoice.client_id);

				const ceiling = await this.getCeiling(cashFlow, manager);

				if (data.amount > ceiling.available) {
					throw new CustomError(
						409,
						lang('invoice.error.payment_amount_exceeds_available', {
							available: ceiling.available.toFixed(2),
						}),
					);
				}

				const outstanding = await this.getOutstanding(manager, invoice);

				if (data.amount > outstanding) {
					throw new CustomError(
						409,
						lang(
							'invoice.error.payment_amount_exceeds_outstanding',
							{
								outstanding: Math.max(outstanding, 0).toFixed(
									2,
								),
							},
						),
					);
				}

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
	 * @description Used by `InvoiceSettlementService` whenever a client's money or documents
	 * change - a movement captured, a document issued
	 *
	 * **Strict FIFO by client.** The client's captured money, oldest movement first, is spread
	 * over their open billing documents, the one falling due first taken first. Which order a
	 * movement was raised for plays no part: a checkout payment from a client with an older
	 * unpaid document settles that one first, and the new order waits for more money. Matched per
	 * currency only - a movement never settles a document in another currency.
	 *
	 * Runs both ways round, so a payment landing before its document and a document issued after
	 * the money are the same case: whatever is open on both sides is paired.
	 *
	 * The whole pairing runs in one transaction under an advisory lock on the client, so two
	 * captures landing together cannot both read the same document as open and over-settle it.
	 * The lock is transaction-scoped and released with the commit.
	 *
	 * Returns the documents it touched, for the caller to re-evaluate their orders.
	 */
	public async settleClient(clientId: number): Promise<InvoiceEntity[]> {
		const touched = await dataSource.transaction(async (manager) => {
			await this.lockClient(manager, clientId);

			const movements = await this.findOpenMovements(manager, clientId);

			if (movements.length === 0) {
				return [];
			}

			const documents = await manager
				.getRepository(InvoiceEntity)
				.createQueryBuilder('invoice')
				.where('invoice.client_id = :clientId', { clientId: clientId })
				.andWhere('invoice.status = :status', {
					status: InvoiceStatusEnum.ISSUED,
				})
				.andWhere('invoice.is_reversal = false')
				.andWhere('invoice.payment_status <> :paid', {
					paid: InvoicePaymentStatusEnum.PAID,
				})
				.orderBy('invoice.due_at', 'ASC', 'NULLS LAST')
				.addOrderBy('invoice.issued_at', 'ASC')
				.addOrderBy('invoice.id', 'ASC')
				.getMany();

			const settled: InvoiceEntity[] = [];

			for (const invoice of documents) {
				let outstanding = await this.getOutstanding(manager, invoice);
				let allocated = false;

				for (const movement of movements) {
					if (outstanding <= PAYMENT_SETTLED_TOLERANCE) {
						break;
					}

					if (
						movement.currency !== invoice.currency ||
						movement.available <= 0
					) {
						continue;
					}

					const amount = roundMoney(
						Math.min(movement.available, outstanding),
					);

					await this.allocate(
						manager,
						invoice.id,
						movement.id,
						amount,
					);

					movement.available = roundMoney(
						movement.available - amount,
					);
					outstanding = roundMoney(outstanding - amount);
					allocated = true;
				}

				if (allocated) {
					settled.push(
						await invoiceService.recomputePaymentStatus(
							manager,
							invoice,
						),
					);
				}
			}

			return settled;
		});

		if (touched.length > 0) {
			await cleanEntityCacheMany(
				InvoiceEntity,
				touched.map((invoice) => invoice.id),
			);
		}

		return touched;
	}

	/**
	 * A client's captured incoming money with something left to give, oldest first. The ceiling
	 * is `maxAllocatableAmount` - gross, unscaled - never `cash_flow.amount`.
	 */
	private async findOpenMovements(
		manager: EntityManager,
		clientId: number,
	): Promise<OpenMovement[]> {
		const rows = await manager.query<
			{
				id: number;
				currency: string;
				amount: number;
				vat_rate: string;
				allocated: string;
			}[]
		>(
			`
				SELECT cash_flow.id, cash_flow.currency, cash_flow.amount, cash_flow.vat_rate,
					COALESCE((
						SELECT SUM(invoice_payment.amount) FROM invoice_payment
						WHERE invoice_payment.cash_flow_id = cash_flow.id
							AND invoice_payment.deleted_at IS NULL
					), 0) AS allocated
				FROM cash_flow
				INNER JOIN operational_record
					ON operational_record.cash_flow_id = cash_flow.id
					AND operational_record.deleted_at IS NULL
					AND operational_record.operational_record_type = $1
				WHERE operational_record.entity_id = $2
					AND cash_flow.deleted_at IS NULL
					AND cash_flow.status = $3
					AND cash_flow.direction = $4
				ORDER BY cash_flow.created_at, cash_flow.id
			`,
			[
				OperationalRecordTypeEnum.CLIENT,
				clientId,
				CashFlowStatusEnum.COMPLETED,
				CashFlowDirectionEnum.IN,
			],
		);

		return rows
			.map((row) => ({
				id: Number(row.id),
				currency: row.currency,
				available: roundMoney(
					maxAllocatableAmount(
						Number(row.amount),
						Number(row.vat_rate),
					) - Number(row.allocated),
				),
			}))
			.filter((movement) => movement.available > 0);
	}

	/**
	 * What a document still asks for: its total less what is allocated to it, and - for an
	 * original - less its issued reversals. A reversal is reversed by nothing; its allocations are
	 * the refunds paid out against it.
	 */
	private async getOutstanding(
		manager: EntityManager,
		invoice: InvoiceEntity,
	): Promise<number> {
		const result = await manager
			.getRepository(InvoicePaymentEntity)
			.createQueryBuilder('invoice_payment')
			.select('COALESCE(SUM(invoice_payment.amount), 0)', 'allocated')
			.where('invoice_payment.invoice_id = :invoice_id', {
				invoice_id: invoice.id,
			})
			.getRawOne<{ allocated: string }>();

		const reversed = invoice.is_reversal
			? 0
			: await invoiceService.getReversedAmount(manager, invoice.id);

		return roundMoney(
			Number(invoice.total_gross) -
				Number(result?.allocated ?? 0) -
				reversed,
		);
	}

	/**
	 * One allocation. The pair is unique over live rows, so a movement already partly allocated
	 * to this document by hand has that row raised rather than a second one written.
	 */
	private async allocate(
		manager: EntityManager,
		invoiceId: number,
		cashFlowId: number,
		amount: number,
	): Promise<void> {
		const repository = manager.getRepository(InvoicePaymentEntity);

		const existing = await repository.findOneBy({
			invoice_id: invoiceId,
			cash_flow_id: cashFlowId,
		});

		if (existing) {
			existing.amount = roundMoney(Number(existing.amount) + amount);

			await repository.save(existing);

			return;
		}

		await repository.save(
			manager.create(InvoicePaymentEntity, {
				invoice_id: invoiceId,
				cash_flow_id: cashFlowId,
				amount: amount,
				notes: null,
			}),
		);
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

		await this.release(invoice, [entry.id]);
	}

	/**
	 * @description Used in `paymentClear` method from controller
	 *
	 * Takes every allocation off a document, handing the money back to the movements it came
	 * from - for an operator to allocate to another of the client's documents. Returns how many
	 * allocations were removed.
	 */
	public async clear(invoice: InvoiceEntity): Promise<number> {
		const entries = await this.repository
			.createQuery()
			.select(['invoice_payment.id'])
			.filterBy('invoice_id', invoice.id)
			.all();

		if (entries.length === 0) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_clear_empty'),
			);
		}

		await this.release(
			invoice,
			entries.map((entry) => entry.id),
		);

		return entries.length;
	}

	/**
	 * Removes allocations from a document and re-reads where it stands, under the client's lock.
	 *
	 * Refused on a reversal and on an original with an issued reversal. A reversal's allocations
	 * are refunds already paid out, and the money they returned is read as owed back from the
	 * original's allocations (`InvoiceService.refundReversal`) - freeing either would let money
	 * that has left the business be allocated, or refunded, a second time. Open movements are
	 * read as amount less allocations, with no refund subtracted, which is why the original's
	 * allocations must stay put once a reversal stands against it.
	 *
	 * Nothing is re-spread here: running FIFO now would hand the money straight back to the
	 * oldest open document, which is usually this one. The next capture or issue for the client
	 * spreads whatever an operator has not allocated by then. The order is not re-read either -
	 * settlement never moves an order back.
	 */
	private async release(
		invoice: InvoiceEntity,
		paymentIds: readonly number[],
	): Promise<void> {
		if (invoice.is_reversal) {
			throw new CustomError(
				409,
				lang('invoice.error.payment_release_reversal'),
			);
		}

		await dataSource.transaction(async (manager) => {
			await this.lockClient(manager, invoice.client_id);

			if (
				(await invoiceService.getReversedAmount(manager, invoice.id)) >
				0
			) {
				throw new CustomError(
					409,
					lang('invoice.error.payment_release_reversed'),
				);
			}

			await manager
				.getRepository(InvoicePaymentEntity)
				.delete({ id: In([...paymentIds]), invoice_id: invoice.id });

			await invoiceService.recomputePaymentStatus(manager, invoice);
		});

		await cleanEntityCache(InvoiceEntity, invoice.id);
	}

	/**
	 * Serializes every write to a client's allocations - FIFO, a manual allocation, a release -
	 * so two cannot read the same movement or document as open. Transaction-scoped, released with
	 * the commit.
	 */
	private async lockClient(
		manager: EntityManager,
		clientId: number,
	): Promise<void> {
		await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', [
			'invoice_payment.client',
			clientId,
		]);
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
