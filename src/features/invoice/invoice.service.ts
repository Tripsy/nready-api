import type { DeepPartial, EntityManager } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError } from '@/exceptions';
import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	AMOUNT_DECIMALS,
	CashFlowCategoryTypeEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { OperationalRecordTypeEnum } from '@/features/cash-flow/operational-record.entity';
import {
	type ClientType,
	ClientTypeEnum,
} from '@/features/client/client.entity';
import { clientService } from '@/features/client/client.service';
import type { ClientAddressSnapshot } from '@/features/client-address/client-address.entity';
import { clientAddressService } from '@/features/client-address/client-address.service';
import { documentSeriesService } from '@/features/document-series/document-series.service';
import InvoiceEntity, {
	type BillingDetails,
	INVOICE_TYPE_DOCUMENT_TYPE,
	INVOICEABLE_ORDER_STATUSES,
	InvoicePaymentStatusEnum,
	type InvoiceStatus,
	InvoiceStatusEnum,
	InvoiceTypeEnum,
	MUTABLE_STATUSES,
	resolvePaymentStatus,
	type SellerDetails,
	STATUS_TRANSITIONS,
} from '@/features/invoice/invoice.entity';
import { getInvoiceRepository } from '@/features/invoice/invoice.repository';
import {
	type InvoiceValidator,
	paramsUpdateList,
} from '@/features/invoice/invoice.validator';
import InvoiceLineEntity, {
	InvoiceLineKindEnum,
} from '@/features/invoice/invoice-line.entity';
import { getInvoiceLineRepository } from '@/features/invoice/invoice-line.repository';
import InvoicePaymentEntity from '@/features/invoice/invoice-payment.entity';
import { getInvoicePaymentRepository } from '@/features/invoice/invoice-payment.repository';
import type OrderEntity from '@/features/order/order.entity';
import { orderService } from '@/features/order/order.service';
import { ShippingStatusEnum } from '@/features/shipping/shipping.entity';
import { getShippingRepository } from '@/features/shipping/shipping.repository';
import { createFutureDate } from '@/helpers/date.helper';
import { arrayHasValue, pickValuesFromObject } from '@/helpers/objects.helper';
import { roundMoney } from '@/helpers/shop.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * A document with what it itemizes and what has been allocated against it - the shape a detail
 * view is given. Flat, like `OrderWithLines`: it is still an invoice, with more on it.
 */
export type InvoiceWithDetails = InvoiceEntity & {
	lines: InvoiceLineEntity[];
	payments: InvoicePaymentEntity[];
};

/** The four stored header figures, summed from the lines. */
export type InvoiceTotals = {
	total_net: number;
	total_discount_reduction: number;
	total_vat: number;
	total_gross: number;
};

/** The arithmetic inputs a line is written from, whatever raised it. */
export type InvoiceLineInput = {
	label: string;
	quantity: number;
	unit_price: number;
	vat_rate: number;
	discount_reduction?: number | null;
};

/**
 * What a listing reads. Explicit, so the two snapshot columns stay out of it: `billing_details`
 * and `seller_details` are jsonb blobs that only the detail view has any use for, and a page of
 * twenty documents would otherwise carry twenty of each.
 */
const ENTRY_COLUMNS = [
	'invoice.id',
	'invoice.order_id',
	'invoice.ref_code',
	'invoice.ref_number',
	'invoice.status',
	'invoice.payment_status',
	'invoice.type',
	'invoice.parent_invoice_id',
	'invoice.currency',
	'invoice.exchange_rate',
	'invoice.total_net',
	'invoice.total_discount_reduction',
	'invoice.total_vat',
	'invoice.total_gross',
	'invoice.issued_at',
	'invoice.due_at',
	'invoice.overdue_at',
	'invoice.paid_at',
	'invoice.notes',
	'invoice.created_at',
	'invoice.updated_at',
	'invoice.deleted_at',
];

/**
 * Enough of the order for a listing to name the document it bills - the reference a person reads,
 * not the id. The dashboard links straight to the order from it.
 */
const ORDER_COLUMNS = [
	'order.id',
	'order.ref_code',
	'order.ref_number',
	'order.status',
];

export class InvoiceService {
	constructor(
		private repository: ReturnType<typeof getInvoiceRepository>,
		private lineRepository: ReturnType<typeof getInvoiceLineRepository>,
		private paymentRepository: ReturnType<
			typeof getInvoicePaymentRepository
		>,
	) {}

	/**
	 * A line's own three figures, computed once and stored - the entity comment on `line_net`
	 * says why they are not derived on read.
	 *
	 * Rounded per step so the parts a reader adds up agree with the total they are shown beside,
	 * the same way `OrderService.computeTotals` sums a basket.
	 */
	public computeLine(input: InvoiceLineInput): {
		line_net: number;
		line_vat: number;
		line_total: number;
		discount_reduction: number;
	} {
		const discountReduction = roundMoney(input.discount_reduction ?? 0);
		const gross = roundMoney(input.unit_price * input.quantity);

		if (discountReduction > gross) {
			throw new BadRequestError(
				lang('invoice.error.line_discount_exceeds_value'),
			);
		}

		const lineNet = roundMoney(gross - discountReduction);
		const lineVat = roundMoney((lineNet * input.vat_rate) / 100);

		return {
			line_net: lineNet,
			line_vat: lineVat,
			line_total: roundMoney(lineNet + lineVat),
			discount_reduction: discountReduction,
		};
	}

	/** The header figures, summed from what the document itemizes. */
	public computeTotals(lines: InvoiceLineEntity[]): InvoiceTotals {
		const totals = lines.reduce(
			(carry, line) => {
				carry.total_net += Number(line.line_net);
				carry.total_discount_reduction += Number(
					line.discount_reduction,
				);
				carry.total_vat += Number(line.line_vat);
				carry.total_gross += Number(line.line_total);

				return carry;
			},
			{
				total_net: 0,
				total_discount_reduction: 0,
				total_vat: 0,
				total_gross: 0,
			},
		);

		return {
			total_net: roundMoney(totals.total_net),
			total_discount_reduction: roundMoney(
				totals.total_discount_reduction,
			),
			total_vat: roundMoney(totals.total_vat),
			total_gross: roundMoney(totals.total_gross),
		};
	}

	/** Only a draft may be rewritten - see `MUTABLE_STATUSES` on the entity. */
	public assertMutable(entry: InvoiceEntity): void {
		if (!arrayHasValue(entry.status, MUTABLE_STATUSES)) {
			throw new CustomError(
				409,
				lang('invoice.error.update_not_allowed'),
			);
		}
	}

	/**
	 * The lines an order produces, in the order they read: what was sold, then what it cost to
	 * send. Both are frozen here - label, unit price, VAT rate and the discount snapshots - so a
	 * later edit to the order or to a pricing helper cannot move a figure already invoiced.
	 *
	 * A bundle header comes across at `price = 0` alongside its components, exactly as the order
	 * carries it: the header says what was bought and the children carry the money, so dropping
	 * it would leave the document itemizing parts nobody ordered by name.
	 */
	public async buildLinesFromOrder(
		order: OrderEntity,
	): Promise<DeepPartial<InvoiceLineEntity>[]> {
		const orderLines = await orderService.getLines(order.id);

		const lines: DeepPartial<InvoiceLineEntity>[] = orderLines.map(
			(orderLine) => {
				const computed = this.computeLine({
					label: orderLine.label ?? `#${orderLine.variant_id}`,
					quantity: Number(orderLine.quantity),
					unit_price: Number(orderLine.price),
					vat_rate: Number(orderLine.vat_rate),
					discount_reduction: Number(orderLine.discount_reduction),
				});

				return {
					kind: InvoiceLineKindEnum.PRODUCT,
					order_line_id: orderLine.id,
					product_id: orderLine.product_id,
					variant_id: orderLine.variant_id,
					label: orderLine.label ?? `#${orderLine.variant_id}`,
					quantity: Number(orderLine.quantity),
					unit_price: Number(orderLine.price),
					vat_rate: Number(orderLine.vat_rate),
					discount: orderLine.discount ?? null,
					...computed,
				};
			},
		);

		/*
		 * A failed movement carried nothing and is not billed; every other status is, including
		 * one still `pending` - an order invoiced up front is charged for the delivery it is
		 * about to get. The money for a delivery lives on the `shipping` row rather than in the
		 * order total, which is why these are lines of their own.
		 */
		const shippingRows = await getShippingRepository()
			.createQuery()
			.select([
				'shipping.id',
				'shipping.scope',
				'shipping.method',
				'shipping.price',
				'shipping.vat_rate',
				'shipping.discount_reduction',
			])
			.filterBy('order_id', order.id)
			.filterBy('status', ShippingStatusEnum.FAILED, '!=')
			.orderBy('id')
			.all();

		for (const shipping of shippingRows) {
			if (Number(shipping.price) <= 0) {
				continue;
			}

			const label = lang(`invoice.label.shipping_${shipping.scope}`);

			lines.push({
				kind: InvoiceLineKindEnum.SHIPPING,
				shipping_id: shipping.id,
				label: label,
				quantity: 1,
				unit_price: Number(shipping.price),
				vat_rate: Number(shipping.vat_rate),
				...this.computeLine({
					label: label,
					quantity: 1,
					unit_price: Number(shipping.price),
					vat_rate: Number(shipping.vat_rate),
					discount_reduction: Number(shipping.discount_reduction),
				}),
			});
		}

		return lines;
	}

	/**
	 * @description Used in `create` method from controller
	 *
	 * The document is raised as a `draft` and holds no number: `document_series` counts
	 * continuously with no release path, so a number is spent only when the document is issued.
	 *
	 * No guard against a second invoice for the same order - a charge and a credit note against
	 * that charge both sit on one order, and a partly shipped order is invoiced per parcel.
	 */
	public async create(
		data: ValidatorOutput<InvoiceValidator, 'create'>,
	): Promise<InvoiceEntity> {
		const type = data.type ?? InvoiceTypeEnum.CHARGE;

		if (type === InvoiceTypeEnum.CREDIT_NOTE) {
			throw new BadRequestError(
				lang('invoice.error.credit_note_needs_parent'),
			);
		}

		const order = await orderService.findById(data.order_id, false);

		if (!arrayHasValue(order.status, INVOICEABLE_ORDER_STATUSES)) {
			throw new CustomError(
				409,
				lang('invoice.error.order_not_invoiceable', {
					statuses: INVOICEABLE_ORDER_STATUSES.join(', '),
				}),
			);
		}

		const lines = await this.buildLinesFromOrder(order);

		if (lines.length === 0) {
			throw new CustomError(409, lang('invoice.error.no_lines'));
		}

		const orderLines = await orderService.getLines(order.id);
		const totals = orderService.computeTotals(orderLines);

		return this.persist({
			entry: {
				order_id: order.id,
				type: type,
				status: InvoiceStatusEnum.DRAFT,
				// The order's own currency and rate: its line figures mean nothing in another
				// one, and no rate on either row converts between the two for the order's date
				currency: totals.currency || Configuration.currency(),
				exchange_rate: totals.exchange_rate,
				due_at: data.due_at ?? null,
				notes: data.notes ?? null,
			},
			lines: lines,
		});
	}

	/**
	 * @description Used by the order-confirmed handler in `invoice.bootstrap.ts`; raises the
	 * charge an order is confirmed for, with no operator action
	 *
	 * `create` carries no guard against a second invoice for an order, and that is right for the
	 * manual path - a charge and the credit note against it both sit on one `order_id`, and a
	 * partly shipped order is invoiced per parcel. An automatic caller needs the opposite, so the
	 * guard lives here: one live charge per order, and a repeated confirm returns `null` rather
	 * than raising a duplicate.
	 *
	 * A canceled charge does not count, which is what makes a failed document recoverable -
	 * cancel it and confirm again.
	 *
	 * Issuing is a second transaction rather than part of `create`'s, so a failure in `issue`
	 * leaves the draft standing - the billing details it refuses on are the client's to fix, and
	 * the draft is what the operator issues once they have. That draft is also what the count
	 * above then finds, so the repair path and the duplicate guard are the same row.
	 */
	public async raiseForOrder(orderId: number): Promise<InvoiceEntity | null> {
		const existing = await this.repository
			.createQuery()
			.filterBy('order_id', orderId)
			.filterBy('type', InvoiceTypeEnum.CHARGE)
			.filterBy('status', InvoiceStatusEnum.CANCELLED, '!=')
			.count();

		if (existing > 0) {
			return null;
		}

		// `due_at` is left unset so `issue` stamps the term from `invoice.dueDays` against the
		// issue date it allocates in the same breath
		const entry = await this.create({
			order_id: orderId,
			type: InvoiceTypeEnum.CHARGE,
			due_at: undefined,
			notes: undefined,
		});

		return this.issue(entry);
	}

	/**
	 * @description Used in `raiseForCashFlow` method from controller; raises the charge a revenue
	 * movement is owed a document for
	 *
	 * This is the back-office counterpart to the checkout chain. The happy path raises the
	 * document from the order and settles it with the money that confirmed it; here an operator
	 * is looking at money already banked and asking for the invoice that accounts for it.
	 *
	 * **The movement's `order` record decides what the document itemizes.** With an order named,
	 * this is `raiseForOrder` - the lines are the order's own lines and its shipping, and the
	 * duplicate guard there means a second press returns the existing charge's absence rather
	 * than a second document. With no order, there is nothing in the catalogue to itemize and the
	 * document carries a single line worth what the movement was worth.
	 *
	 * Settling is not done here: the caller allocates, because only it knows whether the operator
	 * asked for that. See `InvoicePaymentService.settleFromCashFlow`.
	 */
	public async raiseForCashFlow(
		cashFlowId: number,
	): Promise<InvoiceEntity | null> {
		const cashFlow = await cashFlowService.findById(cashFlowId, false);

		if (cashFlow.category_type !== CashFlowCategoryTypeEnum.REVENUE) {
			throw new CustomError(
				409,
				lang('invoice.error.cash_flow_not_revenue'),
			);
		}

		const orderId = await cashFlowService.findOrderId(cashFlowId);

		if (orderId) {
			return this.raiseForOrder(orderId);
		}

		return this.raiseForBareCashFlow(cashFlow);
	}

	/**
	 * A charge for money that names no order.
	 *
	 * Two conditions the order-backed path does not have. The movement must be `completed`,
	 * because a document itemizing nothing but the payment itself is justified by the payment
	 * having landed - and nothing else here could be checked against. And it must not have been
	 * allocated yet: with no `order_id` to count charges against, what a second press would
	 * otherwise duplicate, the allocation left by the first is the only record that this movement
	 * has already been accounted for.
	 *
	 * The buyer is frozen onto the row now rather than at issue time - a bare movement names a
	 * client and nothing else, so there is no order to resolve an address from later.
	 *
	 * The line is `adjustment`: `product` and `shipping` lines name the row they were raised
	 * from, and there is none. Its figure is the movement's net amount, which carries four
	 * decimals against a document's two - a movement whose fifth significant figure is not zero
	 * is invoiced for the rounded amount, and the few hundredths left over stay unallocated on
	 * the movement.
	 */
	private async raiseForBareCashFlow(
		cashFlow: CashFlowEntity,
	): Promise<InvoiceEntity | null> {
		if (cashFlow.status !== CashFlowStatusEnum.COMPLETED) {
			throw new CustomError(
				409,
				lang('invoice.error.cash_flow_not_completed', {
					status: CashFlowStatusEnum.COMPLETED,
				}),
			);
		}

		const allocations = await this.paymentRepository
			.createQuery()
			.filterBy('cash_flow_id', cashFlow.id)
			.count();

		if (allocations > 0) {
			return null;
		}

		const clientId = await cashFlowService.findOperationalRecordId(
			cashFlow.id,
			OperationalRecordTypeEnum.CLIENT,
		);

		if (!clientId) {
			throw new CustomError(
				409,
				lang('invoice.error.cash_flow_no_client'),
			);
		}

		const address =
			await clientAddressService.getBillingSnapshotForClient(clientId);

		// Its own message rather than `billing_address_required`, which speaks of the order: there
		// is none here, and the address that is missing is the client's own
		if (!address) {
			throw new CustomError(
				409,
				lang('invoice.error.cash_flow_client_no_address'),
			);
		}

		const label = lang('invoice.label.cash_flow', {
			reference: cashFlow.external_reference ?? `#${cashFlow.id}`,
		});

		const unitPrice = roundMoney(
			Number(cashFlow.amount) / 10 ** AMOUNT_DECIMALS,
		);

		const entry = await this.persist({
			entry: {
				order_id: null,
				type: InvoiceTypeEnum.CHARGE,
				status: InvoiceStatusEnum.DRAFT,
				currency: cashFlow.currency,
				exchange_rate: cashFlow.exchange_rate,
				billing_details: await this.buildBillingDetails(
					clientId,
					address,
				),
				notes: cashFlow.notes ?? null,
			},
			lines: [
				{
					kind: InvoiceLineKindEnum.ADJUSTMENT,
					label: label,
					quantity: 1,
					unit_price: unitPrice,
					vat_rate: Number(cashFlow.vat_rate),
					...this.computeLine({
						label: label,
						quantity: 1,
						unit_price: unitPrice,
						vat_rate: Number(cashFlow.vat_rate),
					}),
				},
			],
		});

		return this.issue(entry);
	}

	/**
	 * @description Used in `creditNote` method from controller; reverses an issued charge
	 *
	 * The note mirrors its parent's lines rather than recomputing them: what is being taken back
	 * is what was charged, whatever the catalogue says today. Every figure stays positive - the
	 * `type` carries the sign, the way `cash_flow.direction` does.
	 */
	public async createCreditNote(
		parent: InvoiceEntity,
		data: ValidatorOutput<InvoiceValidator, 'creditNote'>,
	): Promise<InvoiceEntity> {
		if (parent.type !== InvoiceTypeEnum.CHARGE) {
			throw new CustomError(
				409,
				lang('invoice.error.credit_note_parent_type'),
			);
		}

		if (parent.status !== InvoiceStatusEnum.ISSUED) {
			throw new CustomError(
				409,
				lang('invoice.error.credit_note_parent_status'),
			);
		}

		const parentLines = await this.getLines(parent.id);

		if (parentLines.length === 0) {
			throw new CustomError(409, lang('invoice.error.no_lines'));
		}

		return this.persist({
			entry: {
				order_id: parent.order_id,
				parent_invoice_id: parent.id,
				type: InvoiceTypeEnum.CREDIT_NOTE,
				status: InvoiceStatusEnum.DRAFT,
				currency: parent.currency,
				exchange_rate: parent.exchange_rate,
				notes: data.notes ?? null,
			},
			lines: parentLines.map((line) => ({
				kind: line.kind,
				order_line_id: line.order_line_id,
				shipping_id: line.shipping_id,
				product_id: line.product_id,
				variant_id: line.variant_id,
				label: line.label,
				quantity: line.quantity,
				unit_price: line.unit_price,
				vat_rate: line.vat_rate,
				discount: line.discount ?? null,
				discount_reduction: line.discount_reduction,
				line_net: line.line_net,
				line_vat: line.line_vat,
				line_total: line.line_total,
				notes: line.notes,
			})),
		});
	}

	/** Header and lines in one transaction, with the totals summed from the lines that landed. */
	private async persist(data: {
		entry: DeepPartial<InvoiceEntity>;
		lines: DeepPartial<InvoiceLineEntity>[];
	}): Promise<InvoiceEntity> {
		return dataSource.transaction(async (manager) => {
			const invoice = await manager
				.getRepository(InvoiceEntity)
				.save(manager.create(InvoiceEntity, data.entry));

			const lines = await manager.getRepository(InvoiceLineEntity).save(
				data.lines.map((line) =>
					manager.create(InvoiceLineEntity, {
						...line,
						invoice_id: invoice.id,
					}),
				),
			);

			Object.assign(invoice, this.computeTotals(lines));

			return manager.getRepository(InvoiceEntity).save(invoice);
		});
	}

	/**
	 * Re-sums the header from what the document itemizes now. Every line write goes through
	 * here, so a total can never be left describing lines that have since changed.
	 *
	 * Takes the caller's `manager` so the lines and the header they add up to move together.
	 */
	public async recomputeTotals(
		manager: EntityManager,
		invoiceId: number,
	): Promise<InvoiceTotals> {
		const lines = await manager.getRepository(InvoiceLineEntity).find({
			where: { invoice_id: invoiceId },
		});

		const totals = this.computeTotals(lines);

		await manager
			.getRepository(InvoiceEntity)
			.update({ id: invoiceId }, totals);

		return totals;
	}

	/**
	 * Where the document stands once its allocations are summed, written back onto the row so a
	 * list can filter on it. `paid_at` records when it was settled and is cleared again if an
	 * allocation is removed - unlike `overdue_at`, which is history and stays.
	 */
	public async recomputePaymentStatus(
		manager: EntityManager,
		invoice: InvoiceEntity,
	): Promise<InvoiceEntity> {
		const result = await manager
			.getRepository(InvoicePaymentEntity)
			.createQueryBuilder('invoice_payment')
			.select('COALESCE(SUM(invoice_payment.amount), 0)', 'allocated')
			.where('invoice_payment.invoice_id = :invoice_id', {
				invoice_id: invoice.id,
			})
			.getRawOne<{ allocated: string }>();

		const allocated = roundMoney(Number(result?.allocated ?? 0));

		const paymentStatus = resolvePaymentStatus(
			Number(invoice.total_gross),
			allocated,
		);

		const isPaid = paymentStatus === InvoicePaymentStatusEnum.PAID;

		invoice.payment_status = paymentStatus;
		invoice.paid_at = isPaid ? (invoice.paid_at ?? new Date()) : null;

		return manager.getRepository(InvoiceEntity).save(invoice);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<InvoiceEntity> & { id: number },
	): Promise<InvoiceEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(InvoiceEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: InvoiceEntity,
		data: ValidatorOutput<InvoiceValidator, 'update'>,
	): Promise<InvoiceEntity> {
		this.assertMutable(entry);

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	/**
	 * @description Used in `statusUpdate` method from controller
	 *
	 * The two moves a document can make are not the same kind of write - issuing spends a number
	 * and freezes the parties onto the row, canceling only invalidates it - so each has its own
	 * method behind the one transition check.
	 */
	public async updateStatus(
		entry: InvoiceEntity,
		newStatus: InvoiceStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		if (newStatus === InvoiceStatusEnum.ISSUED) {
			await this.issue(entry);

			return;
		}

		await this.cancel(entry);
	}

	/**
	 * Hands the document its number and freezes everything a buyer's copy has to keep showing.
	 *
	 * The allocation runs in the same transaction as the save, so a failed insert rolls the
	 * counter back and the series stays gapless - that is what `documentSeriesService.allocate`
	 * takes the caller's manager for.
	 */
	public async issue(entry: InvoiceEntity): Promise<InvoiceEntity> {
		const lines = await this.getLines(entry.id);

		if (lines.length === 0) {
			throw new CustomError(409, lang('invoice.error.no_lines'));
		}

		/*
		 * An order-backed document resolves the buyer now, so an address corrected between
		 * raising and issuing is the one that goes out. A document with no order behind it was
		 * given its buyer when it was raised - there is nothing left to resolve them from - so
		 * what is already on the row stands.
		 */
		const billingDetails = entry.order_id
			? await this.buildBillingDetailsForOrder(
					await orderService.findById(entry.order_id, false),
				)
			: entry.billing_details;

		if (!billingDetails) {
			throw new CustomError(
				409,
				lang('invoice.error.billing_address_required'),
			);
		}

		const sellerDetails = this.buildSellerDetails();

		const issuedAt = new Date();

		const saved = await dataSource.transaction(async (manager) => {
			const reference = await documentSeriesService.allocate(
				manager,
				INVOICE_TYPE_DOCUMENT_TYPE[entry.type],
			);

			Object.assign(entry, {
				status: InvoiceStatusEnum.ISSUED,
				ref_code: reference.code,
				ref_number: reference.number,
				issued_at: issuedAt,
				// Relative to now, which `issued_at` is stamped with in the same breath
				due_at:
					entry.due_at ??
					createFutureDate(
						Configuration.get('invoice.dueDays') * 86400,
					),
				billing_details: billingDetails,
				seller_details: sellerDetails,
			});

			return manager.getRepository(InvoiceEntity).save(entry);
		});

		await cleanEntityCache(InvoiceEntity, saved.id);

		return saved;
	}

	/**
	 * Invalidates a document that was never settled. An invoice with allocations against it has
	 * had money moved for it, and taking that back is a credit note plus its own movement - so
	 * the allocations are what refuses the cancellation rather than the status alone.
	 */
	public async cancel(entry: InvoiceEntity): Promise<InvoiceEntity> {
		const allocations = await this.paymentRepository
			.createQuery()
			.filterBy('invoice_id', entry.id)
			.count();

		if (allocations > 0) {
			throw new CustomError(409, lang('invoice.error.cancel_settled'));
		}

		entry.status = InvoiceStatusEnum.CANCELLED;

		return this.update(entry);
	}

	/**
	 * Only a draft is removable. An issued document is the record of what was charged and stays
	 * reachable whatever happened to it afterwards - `canceled` is how an issued invoice leaves
	 * service, not a delete.
	 */
	public async delete(id: number): Promise<void> {
		const entry = await this.findById(id, false);

		if (entry.status !== InvoiceStatusEnum.DRAFT) {
			throw new CustomError(
				409,
				lang('invoice.error.delete_not_allowed'),
			);
		}

		await this.repository.createQuery().filterById(id).delete();
	}

	public findById(id: number, withDeleted: boolean): Promise<InvoiceEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/** The document's lines, in the order they were written - which is the order they read in. */
	public getLines(invoiceId: number): Promise<InvoiceLineEntity[]> {
		return this.lineRepository
			.createQuery()
			.filterBy('invoice_id', invoiceId)
			.orderBy('id')
			.all();
	}

	public getPayments(invoiceId: number): Promise<InvoicePaymentEntity[]> {
		return this.paymentRepository
			.createQuery()
			.filterBy('invoice_id', invoiceId)
			.orderBy('id')
			.all();
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 *
	 * Three reads rather than one join: a document with twenty lines would otherwise repeat the
	 * header - and its two snapshot columns - twenty times over.
	 */
	public async getEntryData(data: {
		id: number;
		withDeleted: boolean;
	}): Promise<InvoiceWithDetails> {
		const invoice = await this.findById(data.id, data.withDeleted);

		const [lines, payments] = await Promise.all([
			this.getLines(invoice.id),
			this.getPayments(invoice.id),
		]);

		return Object.assign(invoice, {
			lines: lines,
			payments: payments,
		});
	}

	public findByFilter(
		data: ValidatorOutput<InvoiceValidator, 'find'>,
		withDeleted: boolean,
	) {
		const query = this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...ORDER_COLUMNS])
			.joinAndSelect('invoice.order', 'order', 'LEFT')
			.filterById(data.filter.id)
			.filterByTerm(data.filter.term)
			.filterBy('order_id', data.filter.order_id)
			.filterBy('parent_invoice_id', data.filter.parent_invoice_id)
			.filterBy('status', data.filter.status)
			.filterBy('payment_status', data.filter.payment_status)
			.filterBy('type', data.filter.type)
			.filterBy('currency', data.filter.currency)
			.filterByOverdue(data.filter.is_overdue)
			.filterByRange(
				'issued_at',
				data.filter.issued_at_start,
				data.filter.issued_at_end,
			);

		query
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit);

		return query.all(true);
	}

	/**
	 * @description Used in `invoice-overdue.cron.ts`
	 *
	 * Stamps the documents that have just gone past their due date unsettled. Batched rather
	 * than unbounded: the partial index behind it holds only the rows still to be looked at, and
	 * a stamped row leaves it, so a backlog clears over consecutive runs instead of in one
	 * statement holding locks over the whole table.
	 */
	public async stampOverdue(limit: number = 500): Promise<number> {
		const entries = await this.repository
			.createQuery()
			.select(['invoice.id'])
			.filterBy('status', InvoiceStatusEnum.ISSUED)
			.filterBy('payment_status', InvoicePaymentStatusEnum.PAID, '!=')
			.filterRaw('invoice.overdue_at IS NULL')
			.filterByRange('due_at', undefined, new Date())
			.pagination(1, limit)
			.all();

		if (entries.length === 0) {
			return 0;
		}

		const ids = entries.map((entry) => entry.id);

		await this.repository
			.createQuery()
			.filterById(ids)
			.getQuery()
			.update()
			.set({ overdue_at: new Date() })
			.execute();

		await cleanEntityCacheMany(InvoiceEntity, ids);

		return ids.length;
	}

	/**
	 * Who is billed, frozen as the document goes out. The client's own columns rather than the
	 * order's: an order names its counterparty by reference and stays amendable, and this is the
	 * copy that has to keep saying who was billed whatever is edited afterwards.
	 *
	 * A document with no country cannot state its VAT treatment, which is why
	 * `AddressSnapshotRequiredCountry` makes that one field non-nullable and why the refusal is
	 * the caller's to fix before issuing.
	 *
	 * The address is handed in rather than resolved here: an order names the one the buyer chose
	 * at checkout, and a document raised from a bare movement falls back to the client's own
	 * billing address - see `buildBillingDetailsForOrder` and `raiseForCashFlow`.
	 */
	/**
	 * The buyer as the order names them: their own client columns, and the address they chose to
	 * be billed at.
	 *
	 * A billing address deleted between checkout and issuing leaves `order.billing_address_id`
	 * null - the key is `ON DELETE SET NULL` and `client_address` has no soft delete - and the
	 * document has nowhere to be sent, so it is refused until the client is fixed.
	 */
	private async buildBillingDetailsForOrder(
		order: OrderEntity,
	): Promise<BillingDetails> {
		if (!order.billing_address_id) {
			throw new CustomError(
				409,
				lang('invoice.error.billing_address_required'),
			);
		}

		return this.buildBillingDetails(
			order.client_id,
			await clientAddressService.getSnapshotById(
				order.billing_address_id,
			),
		);
	}

	private async buildBillingDetails(
		clientId: number,
		address: ClientAddressSnapshot,
	): Promise<BillingDetails> {
		const client = await clientService.findById(clientId, false);

		if (!address.address_country) {
			throw new CustomError(
				409,
				lang('invoice.error.billing_country_required'),
			);
		}

		const shared = {
			address_country: address.address_country,
			address_region: address.address_region,
			address_city: address.address_city,
			details: address.details,
			postal_code: address.postal_code,
			contact_name: client.contact_name,
			contact_email: client.contact_email,
			contact_phone: client.contact_phone,
			iban: client.iban,
			bank_name: client.bank_name,
		};

		return this.isCompany(client.client_type)
			? {
					...shared,
					type: ClientTypeEnum.COMPANY,
					company_name: client.company_name ?? '',
					company_cui: client.company_cui,
					company_reg_com: client.company_reg_com,
				}
			: {
					...shared,
					type: ClientTypeEnum.PERSON,
					person_name: client.person_name ?? '',
					// `select: false` on the column, so it is never loaded here - a person's
					// identification number is not printed on the documents this issues
					person_identification_number: null,
				};
	}

	private isCompany(
		clientType: ClientType,
	): clientType is typeof ClientTypeEnum.COMPANY {
		return clientType === ClientTypeEnum.COMPANY;
	}

	/**
	 * Who issued it, frozen for the same reason the buyer's details are: the company moves
	 * office, changes bank or re-registers, and a document already handed over keeps showing
	 * what it showed on the day.
	 */
	private buildSellerDetails(): SellerDetails {
		return {
			company_name: Configuration.get('company.name'),
			company_cui: Configuration.get('company.cui'),
			company_reg_com: Configuration.get('company.regCom'),
			address_country: Configuration.get('company.addressCountry'),
			address_region: Configuration.get('company.addressRegion'),
			address_city: Configuration.get('company.addressCity'),
			details: Configuration.get('company.addressDetails'),
			postal_code: Configuration.get('company.postalCode'),
			contact_name: Configuration.get('company.contactName'),
			contact_email: Configuration.get('company.contactEmail'),
			contact_phone: Configuration.get('company.contactPhone'),
			iban: Configuration.get('company.iban'),
			bank_name: Configuration.get('company.bankName'),
		};
	}
}

export const invoiceService = new InvoiceService(
	getInvoiceRepository(),
	getInvoiceLineRepository(),
	getInvoicePaymentRepository(),
);
