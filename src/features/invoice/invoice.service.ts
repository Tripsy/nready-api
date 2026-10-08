import { type DeepPartial, type EntityManager, In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError } from '@/exceptions';
import CashFlowEntity, {
	AMOUNT_DECIMALS,
	CashFlowCategoryTypeEnum,
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
	toGrossAmount,
} from '@/features/cash-flow/cash-flow.entity';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import { CashFlowCategoryEnum } from '@/features/cash-flow/cash-flow-category.enum';
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
	INVOICE_DOCUMENT_TYPE,
	INVOICEABLE_ORDER_STATUSES,
	InvoicePaymentStatusEnum,
	type InvoiceScope,
	InvoiceScopeEnum,
	type InvoiceSources,
	type InvoiceStatus,
	InvoiceStatusEnum,
	type InvoiceWithSources,
	MUTABLE_STATUSES,
	PAYMENT_SETTLED_TOLERANCE,
	resolvePaymentStatus,
	type SellerDetails,
	STATUS_TRANSITIONS,
} from '@/features/invoice/invoice.entity';
import {
	type BillableSource,
	getBillableSourceProvider,
} from '@/features/invoice/invoice.hooks';
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
import InvoiceSourceEntity, {
	type InvoiceSourceType,
	InvoiceSourceTypeEnum,
} from '@/features/invoice/invoice-source.entity';
import OrderEntity from '@/features/order/order.entity';
import { orderService } from '@/features/order/order.service';
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
 * The rows other features own that bill on a document of their own, each with the document scope
 * billing it. Each source type is billed through the provider registered for it in
 * `invoice.hooks.ts`; the order is billed by this feature itself.
 */
const SOURCE_INVOICE_SCOPES = {
	[InvoiceSourceTypeEnum.SHIPPING]: InvoiceScopeEnum.SHIPPING,
	[InvoiceSourceTypeEnum.SUBSCRIPTION]: InvoiceScopeEnum.SUBSCRIPTION,
} as const;

export type BillableSourceType = keyof typeof SOURCE_INVOICE_SCOPES;

const BILLABLE_SOURCE_TYPES = Object.keys(
	SOURCE_INVOICE_SCOPES,
) as BillableSourceType[];

/**
 * A document with what it itemizes and what has been allocated against it - the shape a detail
 * view is given. Flat, like `OrderWithLines`: it is still an invoice, with more on it.
 */
export type InvoiceWithDetails = InvoiceEntity & {
	lines: InvoiceLineWithReversal[];
	payments: InvoicePaymentEntity[];
	amount_outstanding: number | null;
	/**
	 * On a draft only: the parties issuing would freeze if nothing were stated by hand - the
	 * buyer from the order's billing address, the seller from configuration. What an edit form
	 * starts from; `null` where the buyer cannot be resolved yet (no billing address).
	 */
	resolved_billing_details?: BillingDetails | null;
	resolved_seller_details?: SellerDetails;
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

/** Part of an order line to bill - partial shipments, goods and services billed apart. */
export type OrderLineSelection = {
	order_line_id: number;
	quantity: number;
};

/**
 * Part of an issued document's line to take back - exactly one of the two:
 *
 * - `quantity` - goods returned: the units go back to being billable on the order.
 * - `amount` - a price correction, **net**: value off goods the client keeps.
 */
export type InvoiceLineSelection = {
	invoice_line_id: number;
	quantity?: number;
	amount?: number;
};

/** The order a listed document was raised from, as a listing shows it. */
type InvoiceListOrder = Pick<
	OrderEntity,
	'id' | 'ref_code' | 'ref_number' | 'status'
>;

/** A document as a listing reads it: its sources, its order, and what is left to reverse. */
export type InvoiceListEntry = InvoiceWithSources & {
	reversible_net: number | null;
	amount_outstanding: number | null;
	order: InvoiceListOrder | null;
};

/** How much of an original line earlier reversals have already taken back. */
export type ReversedLineTotals = {
	quantity: number; // by quantity reversals only - a value reversal returns no goods
	net: number; // by every reversal, quantity and value alike
};

/**
 * How far a line raised from a source row may be restated on a draft: never past the quantity that
 * row still has to bill, nor above the unit price it carries. An `adjustment` names no source row
 * and has no cap.
 */
export type InvoiceLineCap = {
	max_quantity: number;
	max_unit_price: number;
};

/**
 * An original's line as a detail view shows it, with what is still reversible on it and how far
 * it may be restated - `null` caps on a line with no source row to measure against.
 */
export type InvoiceLineWithReversal = InvoiceLineEntity & {
	reversed_quantity: number;
	reversed_net: number;
	max_quantity: number | null;
	max_unit_price: number | null;
};

/**
 * What a listing reads. Explicit, so the two snapshot columns stay out of it: `billing_details`
 * and `seller_details` are jsonb blobs that only the detail view has any use for, and a page of
 * twenty documents would otherwise carry twenty of each.
 */
const ENTRY_COLUMNS = [
	'invoice.id',
	'invoice.client_id',
	'invoice.ref_code',
	'invoice.ref_number',
	'invoice.status',
	'invoice.payment_status',
	'invoice.scope',
	'invoice.is_reversal',
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

	/**
	 * The part of a line's discount that travels with part of its quantity, so the pieces of a
	 * line billed or reversed over several documents add up to the line. The whole quantity takes
	 * the whole discount as stored, unrounded by the division.
	 */
	private discountShare(
		discount: number,
		wholeQuantity: number,
		partQuantity: number,
	): number {
		if (partQuantity >= wholeQuantity) {
			return discount;
		}

		return roundMoney((discount * partQuantity) / wholeQuantity);
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
	 * How much of each order line is already billed: the quantity on every live document naming
	 * it, less what issued reversals have taken back.
	 *
	 * The two sides are counted differently on purpose. An original counts from `draft`, so two
	 * operators raising the remainder at once cannot both bill it; a reversal counts only once
	 * `issued`, so the quantity is not released for re-billing until the storno has actually gone
	 * out. A partial reversal releases exactly the quantity it took back.
	 */
	public async getBilledQuantities(
		orderId: number,
	): Promise<Map<number, number>> {
		const orderFilter = this.sourceFilter(
			'invoice',
			InvoiceSourceTypeEnum.ORDER,
			orderId,
		);

		const rows = await this.lineRepository
			.createQueryBuilder('line')
			.innerJoin(
				InvoiceEntity,
				'invoice',
				'invoice.id = line.invoice_id AND invoice.deleted_at IS NULL',
			)
			.select('line.order_line_id', 'order_line_id')
			.addSelect(
				'SUM(CASE WHEN invoice.is_reversal THEN -line.quantity ELSE line.quantity END)',
				'quantity',
			)
			.where(orderFilter.condition, orderFilter.parameters)
			.andWhere('line.order_line_id IS NOT NULL')
			.andWhere(
				`(
					(invoice.is_reversal = false AND invoice.status <> :canceled)
					OR (invoice.is_reversal = true AND invoice.status = :issued)
				)`,
				{
					canceled: InvoiceStatusEnum.CANCELLED,
					issued: InvoiceStatusEnum.ISSUED,
				},
			)
			.groupBy('line.order_line_id')
			.getRawMany<{ order_line_id: number; quantity: string }>();

		return new Map(
			rows.map((row) => [
				Number(row.order_line_id),
				Number(row.quantity),
			]),
		);
	}

	/**
	 * The rows of a source type already billed by a live document, counted the way order lines
	 * are - an original from `draft` bills its source, an issued reversal releases it. A reversal
	 * taking back by value only releases nothing: it corrects a price, and the row stays billed.
	 *
	 * Read from `invoice_source`, so it answers for any type a provider registers.
	 */
	public async getBilledSourceIds(
		sourceType: BillableSourceType,
		sourceIds: readonly number[],
	): Promise<Set<number>> {
		if (sourceIds.length === 0) {
			return new Set();
		}

		const rows = await dataSource
			.getRepository(InvoiceSourceEntity)
			.createQueryBuilder('source')
			.innerJoin(
				InvoiceEntity,
				'invoice',
				'invoice.id = source.invoice_id AND invoice.deleted_at IS NULL',
			)
			.select('source.source_id', 'source_id')
			.addSelect(
				'SUM(CASE WHEN invoice.is_reversal THEN -1 ELSE 1 END)',
				'times',
			)
			.where('source.source_type = :sourceType', {
				sourceType: sourceType,
			})
			.andWhere('source.source_id IN (:...sourceIds)', {
				sourceIds: [...sourceIds],
			})
			.andWhere(
				`(
					(invoice.is_reversal = false AND invoice.status <> :canceled)
					OR (
						invoice.is_reversal = true
						AND invoice.status = :issued
						AND EXISTS (
							SELECT 1 FROM invoice_line reversal_line
							WHERE reversal_line.invoice_id = invoice.id
								AND reversal_line.is_value_reversal = false
						)
					)
				)`,
				{
					canceled: InvoiceStatusEnum.CANCELLED,
					issued: InvoiceStatusEnum.ISSUED,
				},
			)
			.groupBy('source.source_id')
			.getRawMany<{ source_id: number; times: string }>();

		return new Set(
			rows
				.filter((row) => Number(row.times) > 0)
				.map((row) => Number(row.source_id)),
		);
	}

	/**
	 * @description Used by `raiseForOrderDocuments` and `OrderSettlementService.getState`
	 *
	 * The rows of an order its registered providers bill automatically and no live document bills
	 * yet - a provider billing a row repeatedly lists none. A type whose feature is not installed
	 * has no provider and contributes nothing.
	 */
	public async getUnbilledSources(
		orderId: number,
	): Promise<{ source_type: BillableSourceType; source: BillableSource }[]> {
		const unbilled: {
			source_type: BillableSourceType;
			source: BillableSource;
		}[] = [];

		for (const sourceType of BILLABLE_SOURCE_TYPES) {
			const provider = getBillableSourceProvider(sourceType);

			if (!provider) {
				continue;
			}

			const sources = await provider.listBillable(orderId);
			const billed = await this.getBilledSourceIds(
				sourceType,
				sources.map((source) => source.id),
			);

			for (const source of sources) {
				if (!billed.has(source.id)) {
					unbilled.push({ source_type: sourceType, source: source });
				}
			}
		}

		return unbilled;
	}

	/**
	 * The caps on each line raised from a source row, keyed by line id.
	 *
	 * A `product` line may bill up to what its order line has not billed elsewhere - this line's
	 * own quantity is added back, since `getBilledQuantities` already counts it - at no more than
	 * the order line's unit price. A `shipping` line is capped by the provider `shipping` registers,
	 * and left uncapped without one. A line whose source row is gone, and every line of a reversal
	 * (whose figures are capped against the original instead), is left out.
	 *
	 * Two reads per call at most - the order's lines with what is billed of them, and the named
	 * movements' ceilings - however many lines are asked about.
	 */
	public async getLineCaps(
		invoice: InvoiceWithSources,
		lines: readonly InvoiceLineEntity[],
	): Promise<Map<number, InvoiceLineCap>> {
		const caps = new Map<number, InvoiceLineCap>();

		if (invoice.is_reversal || !invoice.order_id) {
			return caps;
		}

		const productLines = lines.filter(
			(line) =>
				line.kind === InvoiceLineKindEnum.PRODUCT &&
				line.order_line_id !== null,
		);
		const shippingIds = lines
			.filter(
				(line) =>
					line.kind === InvoiceLineKindEnum.SHIPPING &&
					line.shipping_id !== null,
			)
			.map((line) => Number(line.shipping_id));
		const shippingProvider = getBillableSourceProvider(
			InvoiceSourceTypeEnum.SHIPPING,
		);

		const [orderLines, billed, shippingCaps] = await Promise.all([
			productLines.length > 0
				? orderService.getLines(invoice.order_id)
				: Promise.resolve([]),
			productLines.length > 0
				? this.getBilledQuantities(invoice.order_id)
				: Promise.resolve(new Map<number, number>()),
			shippingIds.length > 0 && shippingProvider
				? shippingProvider.getLineCaps(shippingIds)
				: Promise.resolve(new Map<number, InvoiceLineCap>()),
		]);

		const orderLineById = new Map(
			orderLines.map((orderLine) => [orderLine.id, orderLine]),
		);

		for (const line of productLines) {
			const orderLine = orderLineById.get(Number(line.order_line_id));

			if (!orderLine) {
				continue;
			}

			caps.set(line.id, {
				max_quantity: roundMoney(
					Number(orderLine.quantity) -
						(billed.get(orderLine.id) ?? 0) +
						Number(line.quantity),
				),
				max_unit_price: Number(orderLine.price),
			});
		}

		for (const line of lines) {
			const cap =
				line.kind === InvoiceLineKindEnum.SHIPPING && line.shipping_id
					? shippingCaps.get(line.shipping_id)
					: undefined;

			if (cap) {
				caps.set(line.id, cap);
			}
		}

		return caps;
	}

	/**
	 * The `product` lines an `order` document bills: by default every order line's unbilled
	 * remainder, or exactly the parts named in `selection` - three of ten items shipped now,
	 * services billed apart from goods.
	 *
	 * Everything is frozen here - label, unit price, VAT rate and the discount snapshots - so a
	 * later edit to the order or to a pricing helper cannot move a figure already invoiced. A
	 * partial quantity carries its share of the line's discount, so the parts of a line billed
	 * over several documents add up to the line.
	 *
	 * A bundle header comes across at `price = 0` alongside its components, exactly as the order
	 * carries it: the header says what was bought and the children carry the money, so dropping
	 * it would leave the document itemizing parts nobody ordered by name.
	 */
	public async buildOrderLines(
		order: OrderEntity,
		selection?: readonly OrderLineSelection[],
	): Promise<DeepPartial<InvoiceLineEntity>[]> {
		const [orderLines, billed] = await Promise.all([
			orderService.getLines(order.id),
			this.getBilledQuantities(order.id),
		]);

		const remainingById = new Map(
			orderLines.map((orderLine) => [
				orderLine.id,
				roundMoney(
					Number(orderLine.quantity) -
						(billed.get(orderLine.id) ?? 0),
				),
			]),
		);

		const wanted = selection
			? new Map(
					selection.map((item) => [
						item.order_line_id,
						item.quantity,
					]),
				)
			: remainingById;

		const lines: DeepPartial<InvoiceLineEntity>[] = [];

		for (const [orderLineId] of wanted) {
			if (!remainingById.has(orderLineId)) {
				throw new BadRequestError(
					lang('invoice.error.invalid_order_line', {
						order_line_id: String(orderLineId),
					}),
				);
			}
		}

		for (const orderLine of orderLines) {
			const quantity = wanted.get(orderLine.id);

			if (quantity === undefined || quantity <= 0) {
				continue;
			}

			const remaining = remainingById.get(orderLine.id) ?? 0;

			if (quantity > remaining) {
				throw new CustomError(
					409,
					lang('invoice.error.order_line_over_billed', {
						order_line_id: String(orderLine.id),
						remaining: String(remaining),
					}),
				);
			}

			const orderedQuantity = Number(orderLine.quantity);
			const label = orderLine.label ?? `#${orderLine.variant_id}`;

			const input: InvoiceLineInput = {
				label: label,
				quantity: quantity,
				unit_price: Number(orderLine.price),
				vat_rate: Number(orderLine.vat_rate),
				discount_reduction: this.discountShare(
					Number(orderLine.discount_reduction),
					orderedQuantity,
					quantity,
				),
			};

			lines.push({
				kind: InvoiceLineKindEnum.PRODUCT,
				order_line_id: orderLine.id,
				product_id: orderLine.product_id,
				variant_id: orderLine.variant_id,
				label: label,
				quantity: quantity,
				unit_price: input.unit_price,
				vat_rate: input.vat_rate,
				discount: orderLine.discount ?? null,
				...this.computeLine(input),
			});
		}

		return lines;
	}

	/**
	 * The lines a source row is billed with, as its provider states them. A movement bills on a
	 * `shipping` line naming it; any other row on `adjustment` lines, which name nothing.
	 */
	public buildSourceLines(
		sourceType: BillableSourceType,
		source: BillableSource,
	): DeepPartial<InvoiceLineEntity>[] {
		const isShipping = sourceType === InvoiceSourceTypeEnum.SHIPPING;

		return source.lines.map((line) => ({
			kind: isShipping
				? InvoiceLineKindEnum.SHIPPING
				: InvoiceLineKindEnum.ADJUSTMENT,
			shipping_id: isShipping ? source.id : null,
			label: line.label,
			quantity: line.quantity,
			unit_price: line.unit_price,
			vat_rate: line.vat_rate,
			...this.computeLine(line),
		}));
	}

	/**
	 * @description Used in `create` method from controller, and by the `raise*` methods
	 *
	 * The document is raised as a `draft` and holds no number: `document_series` counts
	 * continuously with no release path, so a number is spent only when the document is issued.
	 *
	 * What it itemizes follows from its scope:
	 *
	 * - `order` - the order's unbilled remainder, or the parts named in `lines`.
	 * - `shipping` / `subscription` - the row named by `shipping_id` / `subscription_id`, with the
	 *   lines its provider states (`buildSourceLines`). Refused when no provider is registered for
	 *   the type, when the row does not belong to the order or cannot be billed, and - for a row
	 *   billed once - when a live document already bills it. A subscription brings no lines yet:
	 *   a period is itemized by hand as `adjustment` lines.
	 *
	 * The order is required for all three - it names who is billed, and in which currency.
	 */
	public async create(
		data: ValidatorOutput<InvoiceValidator, 'create'>,
	): Promise<InvoiceWithSources> {
		const scope: InvoiceScope = data.scope ?? InvoiceScopeEnum.ORDER;

		const order = await orderService.findById(data.order_id, false);

		if (!arrayHasValue(order.status, INVOICEABLE_ORDER_STATUSES)) {
			throw new CustomError(
				409,
				lang('invoice.error.order_not_invoiceable', {
					statuses: INVOICEABLE_ORDER_STATUSES.join(', '),
				}),
			);
		}

		const lines = await this.buildLinesForScope(scope, order, data);

		if (lines.length === 0 && scope !== InvoiceScopeEnum.SUBSCRIPTION) {
			throw new CustomError(409, lang('invoice.error.no_lines'));
		}

		const orderLines = await orderService.getLines(order.id);
		const totals = orderService.computeTotals(orderLines);

		return this.persist({
			entry: {
				client_id: order.client_id,
				order_id: order.id,
				subscription_id:
					scope === InvoiceScopeEnum.SUBSCRIPTION
						? (data.subscription_id ?? null)
						: null,
				shipping_id:
					scope === InvoiceScopeEnum.SHIPPING
						? (data.shipping_id ?? null)
						: null,
				scope: scope,
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

	private async buildLinesForScope(
		scope: InvoiceScope,
		order: OrderEntity,
		data: ValidatorOutput<InvoiceValidator, 'create'>,
	): Promise<DeepPartial<InvoiceLineEntity>[]> {
		switch (scope) {
			case InvoiceScopeEnum.ORDER:
				return this.buildOrderLines(order, data.lines);

			case InvoiceScopeEnum.SHIPPING:
				return this.buildLinesForSource(
					InvoiceSourceTypeEnum.SHIPPING,
					data.shipping_id,
					order.id,
				);

			case InvoiceScopeEnum.SUBSCRIPTION:
				return this.buildLinesForSource(
					InvoiceSourceTypeEnum.SUBSCRIPTION,
					data.subscription_id,
					order.id,
				);

			// A custom document names no order - it is raised through `createCustom`
			case InvoiceScopeEnum.CUSTOM:
				throw new BadRequestError(
					lang('invoice.error.custom_not_from_order'),
				);
		}
	}

	/**
	 * The lines of a document billing one row another feature owns, checked through that feature's
	 * provider - the row exists, belongs to the order and can be billed - and, for a row billed
	 * once, against the documents already billing it.
	 */
	private async buildLinesForSource(
		sourceType: BillableSourceType,
		sourceId: number | undefined,
		orderId: number,
	): Promise<DeepPartial<InvoiceLineEntity>[]> {
		const provider = getBillableSourceProvider(sourceType);

		if (!provider) {
			throw new CustomError(
				409,
				lang('invoice.error.source_not_installed', {
					source: sourceType,
				}),
			);
		}

		const source = sourceId ? await provider.findBillable(sourceId) : null;

		if (!source || source.order_id !== orderId) {
			throw new CustomError(
				409,
				lang('invoice.error.source_not_billable', {
					source: sourceType,
				}),
			);
		}

		if (
			provider.billedOnce &&
			(await this.getBilledSourceIds(sourceType, [source.id])).has(
				source.id,
			)
		) {
			throw new CustomError(
				409,
				lang('invoice.error.source_already_billed', {
					source: sourceType,
				}),
			);
		}

		return this.buildSourceLines(sourceType, source);
	}

	/**
	 * @description Used in `createCustom` method from controller; raises an empty custom draft
	 *
	 * A document built by hand for a client, with no order behind it. It starts with no lines -
	 * they are written through `update`, as `adjustment` lines - and issuing refuses it until it
	 * has one.
	 *
	 * The buyer is frozen from the client's billing address when there is one, since there is no
	 * order to resolve it from at issue time. A client with none gets a draft with no buyer, which
	 * the operator states by hand before issuing - issuing refuses a document with nowhere to go.
	 *
	 * Raised in the deployment's base currency: there is no order or movement to take another one,
	 * and its rate, from.
	 */
	public async createCustom(
		data: ValidatorOutput<InvoiceValidator, 'createCustom'>,
	): Promise<InvoiceWithSources> {
		const client = await clientService.findById(data.client_id, false);

		const address = await clientAddressService.getBillingSnapshotForClient(
			client.id,
		);

		return this.persist({
			entry: {
				client_id: client.id,
				order_id: null,
				subscription_id: null,
				scope: InvoiceScopeEnum.CUSTOM,
				status: InvoiceStatusEnum.DRAFT,
				currency: Configuration.currency(),
				exchange_rate: 1,
				billing_details: address
					? await this.buildBillingDetails(client.id, address)
					: null,
				due_at: data.due_at ?? null,
				notes: data.notes ?? null,
			},
			lines: [],
		});
	}

	/**
	 * @description Used by the settlement handlers in `invoice.bootstrap.ts` and by
	 * `raiseForCashFlow`; bills and issues whatever of an order's goods is not billed yet
	 *
	 * Returns null when nothing is left - which is what makes every automatic caller safe to
	 * repeat: a checkout already billed the order, a second confirm, a document raised by hand
	 * before the payment landed. A canceled document releases its quantities, which is what makes a
	 * failed one recoverable - cancel it and raise again.
	 *
	 * Issuing is a second transaction rather than part of `create`'s, so a failure in `issue`
	 * leaves the draft standing - the billing details it refuses on are the client's to fix, and
	 * the draft is what the operator issues once they have. That draft also holds its quantities,
	 * so the repair path and the duplicate guard are the same row.
	 */
	public async raiseForOrder(
		orderId: number,
	): Promise<InvoiceWithSources | null> {
		const order = await orderService.findById(orderId, false);
		const lines = await this.buildOrderLines(order);

		if (lines.length === 0) {
			return null;
		}

		// `due_at` is left unset so `issue` stamps the term from `invoice.dueDays` against the
		// issue date it allocates in the same breath
		const entry = await this.create({
			order_id: orderId,
			scope: InvoiceScopeEnum.ORDER,
			shipping_id: undefined,
			subscription_id: undefined,
			due_at: undefined,
			notes: undefined,
		});

		return this.issue(entry);
	}

	/**
	 * @description Used by the settlement handlers in `invoice.bootstrap.ts` and by
	 * `raiseForOrderDocuments`; bills and issues one row another feature owns
	 *
	 * Null when there is nothing to bill: no provider for the type, a row its provider does not
	 * bill (a movement with no order, a failed or free one), or a row billed once that a live
	 * document already bills.
	 */
	public async raiseForSource(
		sourceType: BillableSourceType,
		sourceId: number,
	): Promise<InvoiceWithSources | null> {
		const provider = getBillableSourceProvider(sourceType);
		const source = provider ? await provider.findBillable(sourceId) : null;

		if (!provider || !source) {
			return null;
		}

		if (
			provider.billedOnce &&
			(await this.getBilledSourceIds(sourceType, [source.id])).has(
				source.id,
			)
		) {
			return null;
		}

		const entry = await this.create({
			order_id: source.order_id,
			scope: SOURCE_INVOICE_SCOPES[sourceType],
			shipping_id:
				sourceType === InvoiceSourceTypeEnum.SHIPPING
					? source.id
					: undefined,
			subscription_id:
				sourceType === InvoiceSourceTypeEnum.SUBSCRIPTION
					? source.id
					: undefined,
			due_at: undefined,
			notes: undefined,
		});

		return this.issue(entry);
	}

	/**
	 * @description Used by the order-placed and order-confirmed handlers in `invoice.bootstrap.ts`
	 *
	 * Everything an order still owes a document for: its goods, then each row a provider bills on
	 * its own (`getUnbilledSources`) - its movements. The steps fail apart - a shipping document
	 * refused does not take back the goods document already issued - so the first refusal is
	 * rethrown only after every step has had its go, for the registry to log.
	 */
	public async raiseForOrderDocuments(
		orderId: number,
	): Promise<InvoiceWithSources[]> {
		const raised: InvoiceWithSources[] = [];
		let firstError: unknown = null;

		const attempt = async (
			step: () => Promise<InvoiceWithSources | null>,
		): Promise<void> => {
			try {
				const invoice = await step();

				if (invoice) {
					raised.push(invoice);
				}
			} catch (error) {
				firstError = firstError ?? error;
			}
		};

		await attempt(() => this.raiseForOrder(orderId));

		for (const unbilled of await this.getUnbilledSources(orderId)) {
			await attempt(() =>
				this.raiseForSource(unbilled.source_type, unbilled.source.id),
			);
		}

		if (firstError) {
			throw firstError;
		}

		return raised;
	}

	/**
	 * @description Answers `isOrderInvoiced` on the settlement registry, for `OrderService.updateData`
	 *
	 * Any live `order` document locks the lines, draft included: a draft already froze the
	 * figures it was raised from, and rewriting the lines under it would leave it billing goods the
	 * order no longer lists.
	 */
	public async hasLiveOrderInvoice(orderId: number): Promise<boolean> {
		const orderFilter = this.sourceFilter(
			'invoice',
			InvoiceSourceTypeEnum.ORDER,
			orderId,
		);

		const count = await this.repository
			.createQuery()
			.filterRaw(orderFilter.condition, orderFilter.parameters)
			.filterBy('scope', InvoiceScopeEnum.ORDER)
			.filterBy('is_reversal', false)
			.filterBy('status', InvoiceStatusEnum.CANCELLED, '!=')
			.count();

		return count > 0;
	}

	/**
	 * @description Used in `raiseForCashFlow` method from controller; raises the document a revenue
	 * movement is owed
	 *
	 * The back-office counterpart to the checkout chain: an operator looking at money already
	 * banked and asking for the invoice that accounts for it.
	 *
	 * **The movement's `order` record decides what the document itemizes.** With an order named,
	 * this is `raiseForOrder` - the order's unbilled goods, and null when nothing is left. With no
	 * order, there is nothing in the catalogue to itemize and the document carries a single line
	 * worth what the movement was worth.
	 *
	 * Settling is not done here: the caller runs the client's allocation, oldest document first.
	 */
	public async raiseForCashFlow(
		cashFlowId: number,
	): Promise<InvoiceWithSources | null> {
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
	 * A charge for money that names no order: a `custom` document, since there is nothing in the
	 * catalogue to itemize.
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
	): Promise<InvoiceWithSources | null> {
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
				client_id: clientId,
				order_id: null,
				scope: InvoiceScopeEnum.CUSTOM,
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
	 * How much of each line of a document has already been taken back, by every reversal raised
	 * against it that is not canceled - draft included, so two operators reversing the same
	 * document at once cannot both take the same quantity or value back.
	 */
	public async getReversedPerLine(
		parentId: number,
	): Promise<Map<number, ReversedLineTotals>> {
		const rows = await this.lineRepository
			.createQueryBuilder('line')
			.innerJoin(
				InvoiceEntity,
				'invoice',
				'invoice.id = line.invoice_id AND invoice.deleted_at IS NULL',
			)
			.select('line.parent_line_id', 'parent_line_id')
			.addSelect(
				'COALESCE(SUM(CASE WHEN line.is_value_reversal THEN 0 ELSE line.quantity END), 0)',
				'quantity',
			)
			.addSelect('COALESCE(SUM(line.line_net), 0)', 'net')
			.where('invoice.parent_invoice_id = :parentId', {
				parentId: parentId,
			})
			.andWhere('invoice.status <> :canceled', {
				canceled: InvoiceStatusEnum.CANCELLED,
			})
			.andWhere('line.parent_line_id IS NOT NULL')
			.groupBy('line.parent_line_id')
			.getRawMany<{
				parent_line_id: number;
				quantity: string;
				net: string;
			}>();

		return new Map(
			rows.map((row) => [
				Number(row.parent_line_id),
				{
					quantity: roundMoney(Number(row.quantity)),
					net: roundMoney(Number(row.net)),
				},
			]),
		);
	}

	/**
	 * @description Used in `reverse` method from controller; raises a storno against an issued
	 * document
	 *
	 * The reversal is a document of the original's own scope - a reversed shipping document still
	 * reads as shipping - flagged `is_reversal` and numbered from the same series once issued.
	 *
	 * Each picked line is taken back either by **quantity** (goods returned - the line's figures
	 * for that many units, its discount shared out, and the units billable again) or by **value**
	 * (a net price correction on goods the client keeps - one unit worth the amount, at the line's
	 * VAT rate). Two caps hold per original line, across every reversal raised against it:
	 * quantity up to what quantity reversals left, and net value up to what all reversals left.
	 *
	 * With no `lines`, the remaining units of every line are taken back by quantity - goods coming
	 * back is the common storno, and the dashboard form opens the same way. A line already
	 * corrected by value far enough that its remaining units no longer fit in its remaining net is
	 * left out: it cannot hand back its units at full price, and turning it into a value line is a
	 * decision for whoever raises the reversal, made by sending `lines`.
	 *
	 * Every figure stays positive; `is_reversal` carries the sign.
	 */
	public async createReversal(
		parent: InvoiceWithSources,
		data: ValidatorOutput<InvoiceValidator, 'reverse'>,
	): Promise<InvoiceWithSources> {
		if (parent.is_reversal) {
			throw new CustomError(
				409,
				lang('invoice.error.reversal_of_reversal'),
			);
		}

		if (parent.status !== InvoiceStatusEnum.ISSUED) {
			throw new CustomError(
				409,
				lang('invoice.error.reversal_parent_status'),
			);
		}

		const [parentLines, reversed] = await Promise.all([
			this.getLines(parent.id),
			this.getReversedPerLine(parent.id),
		]);

		const remaining = new Map(
			parentLines.map((line) => {
				const taken = reversed.get(line.id);

				return [
					line.id,
					{
						quantity: roundMoney(
							Number(line.quantity) - (taken?.quantity ?? 0),
						),
						net: roundMoney(
							Number(line.line_net) - (taken?.net ?? 0),
						),
					},
				];
			}),
		);

		const selection: InvoiceLineSelection[] =
			data.lines ?? this.everythingReversible(parentLines, remaining);

		const linesById = new Map(parentLines.map((line) => [line.id, line]));
		const lines: DeepPartial<InvoiceLineEntity>[] = [];

		for (const item of selection) {
			const line = linesById.get(item.invoice_line_id);
			const left = remaining.get(item.invoice_line_id);

			if (!line || !left) {
				throw new BadRequestError(
					lang('invoice.error.invalid_invoice_line', {
						invoice_line_id: String(item.invoice_line_id),
					}),
				);
			}

			const reversal =
				item.amount !== undefined
					? this.buildValueReversalLine(line, item.amount)
					: this.buildQuantityReversalLine(
							line,
							item.quantity ?? 0,
							left,
						);

			if (
				Number(reversal.line_net) >
				left.net + PAYMENT_SETTLED_TOLERANCE
			) {
				throw new CustomError(
					409,
					lang('invoice.error.reversal_value_over', {
						invoice_line_id: String(line.id),
						remaining: left.net.toFixed(2),
					}),
				);
			}

			left.net = roundMoney(left.net - Number(reversal.line_net));

			if (!reversal.is_value_reversal) {
				left.quantity = roundMoney(
					left.quantity - Number(reversal.quantity),
				);
			}

			lines.push(reversal);
		}

		if (lines.length === 0) {
			throw new CustomError(
				409,
				lang('invoice.error.nothing_to_reverse'),
			);
		}

		return this.persist({
			entry: {
				client_id: parent.client_id,
				order_id: parent.order_id,
				subscription_id: parent.subscription_id,
				shipping_id: parent.shipping_id,
				parent_invoice_id: parent.id,
				scope: parent.scope,
				is_reversal: true,
				status: InvoiceStatusEnum.DRAFT,
				currency: parent.currency,
				exchange_rate: parent.exchange_rate,
				// A storno names the parties the original went out to, as frozen on it - not the
				// client's address today, and not nothing: a document with no order behind it has
				// nowhere else to take a buyer from, and its parties cannot be stated by hand
				billing_details: parent.billing_details,
				seller_details: parent.seller_details,
				notes: data.notes ?? null,
			},
			lines: lines,
		});
	}

	/** The default selection: every line's remaining units, where they still fit in its value. */
	private everythingReversible(
		parentLines: readonly InvoiceLineEntity[],
		remaining: ReadonlyMap<number, ReversedLineTotals>,
	): InvoiceLineSelection[] {
		const selection: InvoiceLineSelection[] = [];

		for (const line of parentLines) {
			const left = remaining.get(line.id);

			if (!left || left.net <= 0 || left.quantity <= 0) {
				continue;
			}

			const quantityNet = this.computeLine({
				label: line.label,
				quantity: left.quantity,
				unit_price: Number(line.unit_price),
				vat_rate: Number(line.vat_rate),
				discount_reduction: this.discountShare(
					Number(line.discount_reduction),
					Number(line.quantity),
					left.quantity,
				),
			}).line_net;

			if (quantityNet <= left.net + PAYMENT_SETTLED_TOLERANCE) {
				selection.push({
					invoice_line_id: line.id,
					quantity: left.quantity,
				});
			}
		}

		return selection;
	}

	/**
	 * Goods returned. A full quantity mirrors the original line's stored figures, so a full
	 * reversal nets to exactly zero; a part is recomputed with its share of the discount.
	 */
	private buildQuantityReversalLine(
		line: InvoiceLineEntity,
		quantity: number,
		left: ReversedLineTotals,
	): DeepPartial<InvoiceLineEntity> {
		if (quantity <= 0 || quantity > left.quantity) {
			throw new CustomError(
				409,
				lang('invoice.error.reversal_line_over', {
					invoice_line_id: String(line.id),
					remaining: String(left.quantity),
				}),
			);
		}

		const isWhole = quantity === Number(line.quantity);

		const input: InvoiceLineInput = {
			label: line.label,
			quantity: quantity,
			unit_price: Number(line.unit_price),
			vat_rate: Number(line.vat_rate),
			discount_reduction: this.discountShare(
				Number(line.discount_reduction),
				Number(line.quantity),
				quantity,
			),
		};

		return {
			kind: line.kind,
			parent_line_id: line.id,
			is_value_reversal: false,
			order_line_id: line.order_line_id,
			shipping_id: line.shipping_id,
			product_id: line.product_id,
			variant_id: line.variant_id,
			label: line.label,
			quantity: quantity,
			unit_price: input.unit_price,
			vat_rate: input.vat_rate,
			discount: line.discount ?? null,
			notes: line.notes,
			...(isWhole
				? {
						discount_reduction: Number(line.discount_reduction),
						line_net: Number(line.line_net),
						line_vat: Number(line.line_vat),
						line_total: Number(line.line_total),
					}
				: this.computeLine(input)),
		};
	}

	/**
	 * A net price correction: one unit worth `amount`, VAT added at the original line's rate.
	 * Names no source row, so no units or delivery go back to being billable.
	 */
	private buildValueReversalLine(
		line: InvoiceLineEntity,
		amount: number,
	): DeepPartial<InvoiceLineEntity> {
		const label = lang('invoice.label.value_reversal', {
			label: line.label,
		});

		const unitPrice = roundMoney(amount);

		return {
			kind: line.kind,
			parent_line_id: line.id,
			is_value_reversal: true,
			order_line_id: null,
			shipping_id: null,
			product_id: line.product_id,
			variant_id: line.variant_id,
			label: label,
			quantity: 1,
			unit_price: unitPrice,
			vat_rate: Number(line.vat_rate),
			discount: null,
			notes: null,
			...this.computeLine({
				label: label,
				quantity: 1,
				unit_price: unitPrice,
				vat_rate: Number(line.vat_rate),
			}),
		};
	}

	/** Header and lines in one transaction, with the totals summed from the lines that landed. */
	private async persist(data: {
		entry: DeepPartial<InvoiceEntity> & Partial<InvoiceSources>;
		lines: DeepPartial<InvoiceLineEntity>[];
	}): Promise<InvoiceWithSources> {
		const {
			order_id: orderId,
			shipping_id: shippingId,
			subscription_id: subscriptionId,
			...entry
		} = data.entry;

		const sources: InvoiceSources = {
			order_id: orderId ?? null,
			shipping_id: shippingId ?? null,
			subscription_id: subscriptionId ?? null,
		};

		return dataSource.transaction(async (manager) => {
			const invoice = await manager
				.getRepository(InvoiceEntity)
				.save(manager.create(InvoiceEntity, entry));

			await this.writeSources(manager, invoice.id, sources);

			const lines = await manager.getRepository(InvoiceLineEntity).save(
				data.lines.map((line) =>
					manager.create(InvoiceLineEntity, {
						...line,
						invoice_id: invoice.id,
					}),
				),
			);

			Object.assign(invoice, this.computeTotals(lines));

			const saved = await manager
				.getRepository(InvoiceEntity)
				.save(invoice);

			return Object.assign(saved, sources);
		});
	}

	/** The links a document is raised with - see `invoice-source.entity.ts`. Written once. */
	private async writeSources(
		manager: EntityManager,
		invoiceId: number,
		sources: InvoiceSources,
	): Promise<void> {
		const rows = (
			[
				[InvoiceSourceTypeEnum.ORDER, sources.order_id],
				[InvoiceSourceTypeEnum.SHIPPING, sources.shipping_id],
				[InvoiceSourceTypeEnum.SUBSCRIPTION, sources.subscription_id],
			] as const
		)
			.filter(([, sourceId]) => sourceId !== null)
			.map(([sourceType, sourceId]) =>
				manager.create(InvoiceSourceEntity, {
					invoice_id: invoiceId,
					source_type: sourceType,
					source_id: Number(sourceId),
				}),
			);

		if (rows.length > 0) {
			await manager.getRepository(InvoiceSourceEntity).save(rows);
		}
	}

	/**
	 * Puts on each document what it was raised from, read off `invoice_source` in one query for
	 * the lot. The only way an `InvoiceWithSources` is made from a loaded row: the sources are not
	 * columns, so a row loaded any other way does not carry them, and a caller that needs one says
	 * so by type.
	 */
	public async withSources<T extends InvoiceEntity>(
		entries: T[],
		manager: EntityManager = dataSource.manager,
	): Promise<(T & InvoiceSources)[]> {
		const ids = entries.map((entry) => entry.id);

		const rows =
			ids.length === 0
				? []
				: await manager.getRepository(InvoiceSourceEntity).find({
						select: {
							invoice_id: true,
							source_type: true,
							source_id: true,
						},
						where: { invoice_id: In(ids) },
					});

		const sourceOf = (invoiceId: number, type: InvoiceSourceType) =>
			rows.find(
				(row) =>
					row.invoice_id === invoiceId && row.source_type === type,
			)?.source_id ?? null;

		return entries.map((entry) =>
			Object.assign(entry, {
				order_id: sourceOf(entry.id, InvoiceSourceTypeEnum.ORDER),
				shipping_id: sourceOf(entry.id, InvoiceSourceTypeEnum.SHIPPING),
				subscription_id: sourceOf(
					entry.id,
					InvoiceSourceTypeEnum.SUBSCRIPTION,
				),
			}),
		);
	}

	/**
	 * The ids of the documents raised from one source - "the documents of order X" - for a caller
	 * that loads them its own way.
	 */
	public async findIdsBySource(
		sourceType: InvoiceSourceType,
		sourceId: number,
		manager: EntityManager = dataSource.manager,
	): Promise<number[]> {
		const rows = await manager.getRepository(InvoiceSourceEntity).find({
			select: { invoice_id: true },
			where: { source_type: sourceType, source_id: sourceId },
		});

		return rows.map((row) => row.invoice_id);
	}

	/**
	 * A condition on `alias` matching the documents raised from one source, with its parameters
	 * named after the source type so several compose in one query. A subquery rather than a join,
	 * so it never multiplies the rows it filters.
	 */
	private sourceFilter(
		alias: string,
		sourceType: InvoiceSourceType,
		sourceId: number,
	): { condition: string; parameters: Record<string, string | number> } {
		const key = `source_${sourceType}`;

		return {
			condition: `${alias}.id IN (
				SELECT invoice_source.invoice_id FROM invoice_source
				WHERE invoice_source.source_type = :${key}_type
					AND invoice_source.source_id = :${key}_id
					AND invoice_source.deleted_at IS NULL
			)`,
			parameters: {
				[`${key}_type`]: sourceType,
				[`${key}_id`]: sourceId,
			},
		};
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
	 * What has been taken off a document by the reversals issued against it. Draft and canceled
	 * reversals take nothing off.
	 */
	public async getReversedAmount(
		manager: EntityManager,
		invoiceId: number,
	): Promise<number> {
		const result = await manager
			.getRepository(InvoiceEntity)
			.createQueryBuilder('invoice')
			.select('COALESCE(SUM(invoice.total_gross), 0)', 'reversed')
			.where('invoice.parent_invoice_id = :invoice_id', {
				invoice_id: invoiceId,
			})
			.andWhere('invoice.is_reversal = true')
			.andWhere('invoice.status = :status', {
				status: InvoiceStatusEnum.ISSUED,
			})
			.getRawOne<{ reversed: string }>();

		return roundMoney(Number(result?.reversed ?? 0));
	}

	/**
	 * Where the document stands once its allocations are summed, written back onto the row so a
	 * list can filter on it. `paid_at` records when it was settled and is cleared again if an
	 * allocation is removed - unlike `overdue_at`, which is history and stays.
	 *
	 * An original also counts what its issued reversals took off: a document reversed in full is
	 * owed nothing, and leaving it `unpaid` would keep it in front of every payment the client
	 * makes and keep its order from ever being settled. A reversal itself counts only its
	 * allocations - the refunds paid out against it.
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

		const reversed = invoice.is_reversal
			? 0
			: await this.getReversedAmount(manager, invoice.id);

		const allocated = roundMoney(Number(result?.allocated ?? 0) + reversed);

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
	 *
	 * With `lines`, the draft's lines are made to read that set in the same write - see
	 * `planLineSet` - and the document comes back re-read, with its totals re-summed.
	 */
	public async updateData(
		entry: InvoiceWithSources,
		data: ValidatorOutput<InvoiceValidator, 'update'>,
	): Promise<InvoiceEntity> {
		this.assertMutable(entry);

		// A reversal bills the buyer of the invoice it takes back, so its parties are not
		// restated by hand
		if (
			entry.is_reversal &&
			(data.billing_details !== undefined ||
				data.seller_details !== undefined)
		) {
			throw new CustomError(
				409,
				lang('invoice.error.reversal_party_locked'),
			);
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		if (data.lines === undefined) {
			return this.update(entry);
		}

		const { writes, removedIds } = await this.planLineSet(
			entry,
			data.lines,
		);

		// One transaction for the header, every line and the re-summed totals: a refusal half
		// way leaves the draft exactly as it was
		await dataSource.transaction(async (manager) => {
			await manager.getRepository(InvoiceEntity).save(entry);

			if (removedIds.length > 0) {
				await manager
					.getRepository(InvoiceLineEntity)
					.softDelete(removedIds);
			}

			if (writes.length > 0) {
				await manager.getRepository(InvoiceLineEntity).save(writes);
			}

			await this.recomputeTotals(manager, entry.id);
		});

		await cleanEntityCache(InvoiceEntity, entry.id);

		return this.findById(entry.id, false);
	}

	/**
	 * Turns the line set an `update` carries into the writes that make the draft read it: the
	 * lines to save - restated or new - and the ids of those left out, to remove.
	 *
	 * Everything is checked before anything is written, the same rules the per-line endpoints
	 * apply: a new line is an `adjustment`; a line raised from a source row stays within its cap;
	 * a reversal's figures follow the invoice it reverses, so it takes no new line and only its
	 * labels and notes may change. A line that would not change is not written.
	 */
	private async planLineSet(
		entry: InvoiceWithSources,
		items: NonNullable<
			ValidatorOutput<InvoiceValidator, 'update'>['lines']
		>,
	): Promise<{ writes: InvoiceLineEntity[]; removedIds: number[] }> {
		const existing = await this.getLines(entry.id);
		const existingById = new Map(existing.map((line) => [line.id, line]));
		const caps = await this.getLineCaps(entry, existing);

		const keptIds = new Set<number>();
		const writes: InvoiceLineEntity[] = [];

		for (const item of items) {
			const input: InvoiceLineInput = {
				label: item.label,
				quantity: item.quantity,
				unit_price: item.unit_price,
				vat_rate: item.vat_rate,
				discount_reduction: item.discount_reduction,
			};

			if (item.id == null) {
				if (entry.is_reversal) {
					throw new CustomError(
						409,
						lang('invoice.error.reversal_line_locked'),
					);
				}

				writes.push(
					this.lineRepository.create({
						invoice_id: entry.id,
						kind: InvoiceLineKindEnum.ADJUSTMENT,
						label: item.label,
						quantity: item.quantity,
						unit_price: item.unit_price,
						vat_rate: item.vat_rate,
						notes: item.notes ?? null,
						...this.computeLine(input),
					}),
				);

				continue;
			}

			const line = existingById.get(item.id);

			if (!line) {
				throw new CustomError(
					409,
					lang('invoice.error.invalid_invoice_line', {
						invoice_line_id: String(item.id),
					}),
				);
			}

			keptIds.add(line.id);

			const figuresChanged =
				Number(line.quantity) !== item.quantity ||
				Number(line.unit_price) !== item.unit_price ||
				Number(line.vat_rate) !== item.vat_rate ||
				Number(line.discount_reduction) !==
					(item.discount_reduction ?? 0);

			if (
				!figuresChanged &&
				line.label === item.label &&
				(item.notes === undefined || line.notes === item.notes)
			) {
				continue;
			}

			if (figuresChanged) {
				if (entry.is_reversal) {
					throw new CustomError(
						409,
						lang('invoice.error.reversal_line_locked'),
					);
				}

				this.assertWithinCap(line.id, input, caps.get(line.id));

				Object.assign(line, {
					quantity: item.quantity,
					unit_price: item.unit_price,
					vat_rate: item.vat_rate,
					...this.computeLine(input),
				});
			}

			Object.assign(line, {
				label: item.label,
				notes: item.notes ?? line.notes,
			});

			writes.push(line);
		}

		return {
			writes: writes,
			removedIds: existing
				.filter((line) => !keptIds.has(line.id))
				.map((line) => line.id),
		};
	}

	/**
	 * Refuses a restatement past what the line's source row carries - see `getLineCaps`. A line
	 * with no cap passes.
	 */
	public assertWithinCap(
		lineId: number,
		input: Pick<InvoiceLineInput, 'quantity' | 'unit_price'>,
		cap: InvoiceLineCap | undefined,
	): void {
		if (cap && input.quantity > cap.max_quantity) {
			throw new CustomError(
				409,
				lang('invoice.error.line_quantity_over', {
					invoice_line_id: String(lineId),
					max: String(cap.max_quantity),
				}),
			);
		}

		if (cap && input.unit_price > cap.max_unit_price) {
			throw new CustomError(
				409,
				lang('invoice.error.line_price_over', {
					invoice_line_id: String(lineId),
					max: String(cap.max_unit_price),
				}),
			);
		}
	}

	/**
	 * @description Used in `statusUpdate` method from controller
	 *
	 * The two moves a document can make are not the same kind of write - issuing spends a number
	 * and freezes the parties onto the row, canceling only invalidates it - so each has its own
	 * method behind the one transition check.
	 */
	public async updateStatus(
		entry: InvoiceWithSources,
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
	 * The due date an issued document carries. A date the draft was given stands only while it
	 * is still ahead of the issue: one that has already passed - a draft left open past it -
	 * would put the document overdue the moment it goes out, so it gives way to the standard
	 * term, the same as a draft that named none.
	 *
	 * The term runs from now, which `issued_at` is stamped with in the same breath.
	 */
	public resolveDueAt(dueAt: Date | null, issuedAt: Date): Date {
		if (dueAt && new Date(dueAt).getTime() >= issuedAt.getTime()) {
			return dueAt;
		}

		return createFutureDate(Configuration.get('invoice.dueDays') * 86400);
	}

	/**
	 * Hands the document its number and freezes everything a buyer's copy has to keep showing.
	 *
	 * The allocation runs in the same transaction as the save, so a failed insert rolls the
	 * counter back and the series stays gapless - that is what `documentSeriesService.allocate`
	 * takes the caller's manager for. The client's ledger entry is written in the same
	 * transaction, so a document is never issued without the balance moving by it, and an issued
	 * reversal re-reads its parent's payment status there too.
	 *
	 * Settling the client's money against the new document is not done here: allocation reads
	 * `invoice_payment`, which `InvoicePaymentService` owns and which imports this service. The
	 * callers run `invoiceSettlementService.afterIssued`.
	 */
	public async issue(entry: InvoiceWithSources): Promise<InvoiceWithSources> {
		const lines = await this.getLines(entry.id);

		if (lines.length === 0) {
			throw new CustomError(409, lang('invoice.error.no_lines'));
		}

		/*
		 * Parties stated by hand on the draft go out as given. Otherwise an order-backed document
		 * resolves the buyer now, so an address corrected between raising and issuing is the one
		 * that goes out; a document with no order behind it was given its buyer when it was
		 * raised, and what is on the row stands.
		 */
		const billingDetails =
			entry.billing_details ??
			(entry.order_id
				? await this.buildBillingDetailsForOrder(
						await orderService.findById(entry.order_id, false),
					)
				: null);

		if (!billingDetails) {
			throw new CustomError(
				409,
				lang('invoice.error.billing_address_required'),
			);
		}

		const sellerDetails = entry.seller_details ?? this.buildSellerDetails();

		const issuedAt = new Date();
		const refundedMovementIds: number[] = [];

		const saved = await dataSource.transaction(async (manager) => {
			const reference = await documentSeriesService.allocate(
				manager,
				INVOICE_DOCUMENT_TYPE,
			);

			Object.assign(entry, {
				status: InvoiceStatusEnum.ISSUED,
				ref_code: reference.code,
				ref_number: reference.number,
				issued_at: issuedAt,
				due_at: this.resolveDueAt(entry.due_at, issuedAt),
				billing_details: billingDetails,
				seller_details: sellerDetails,
			});

			const issued = await manager
				.getRepository(InvoiceEntity)
				.save(entry);

			await this.recomputeParentPaymentStatus(manager, issued);

			refundedMovementIds.push(
				...(await this.refundReversal(manager, issued)),
			);

			return issued;
		});

		await cleanEntityCache(InvoiceEntity, saved.id);

		// A movement's read carries its refunds
		if (refundedMovementIds.length > 0) {
			await cleanEntityCacheMany(CashFlowEntity, refundedMovementIds);
		}

		if (saved.parent_invoice_id) {
			await cleanEntityCache(InvoiceEntity, saved.parent_invoice_id);
		}

		return saved;
	}

	/**
	 * Pays a client back what an issued reversal leaves them overpaid on the original: completed
	 * refund cash flows, each allocated to the reversal - in the issue transaction, so a reversal
	 * never goes out without the money it owes going with it. Completing one through `cash-flow`
	 * books it on the client ledger, in that same transaction.
	 *
	 * Owed back is what was paid on the original less what the original still asks for once every
	 * issued reversal is taken off, less what earlier reversals already refunded - capped at this
	 * reversal's own total. An unpaid original is owed nothing: the reversal only lowers a debt,
	 * and no money moves. Always refunded, never offset against the client's other documents.
	 *
	 * A refund names the incoming movement it returns (`cash_flow.parent_id`), so the money is
	 * taken from the original's allocations, newest first, each within what is left of its
	 * movement. Returns the movements refunded from, whose cached reads carry their refunds.
	 */
	private async refundReversal(
		manager: EntityManager,
		reversal: InvoiceEntity,
	): Promise<number[]> {
		if (!reversal.is_reversal || !reversal.parent_invoice_id) {
			return [];
		}

		const parent = await manager
			.getRepository(InvoiceEntity)
			.findOneByOrFail({ id: reversal.parent_invoice_id });

		const allocations = await manager
			.getRepository(InvoicePaymentEntity)
			.find({ where: { invoice_id: parent.id }, order: { id: 'DESC' } });

		const paid = roundMoney(
			allocations.reduce(
				(carry, allocation) => carry + Number(allocation.amount),
				0,
			),
		);

		if (paid <= PAYMENT_SETTLED_TOLERANCE) {
			return [];
		}

		const [reversed, refunded] = await Promise.all([
			this.getReversedAmount(manager, parent.id),
			this.getRefundedForParent(manager, parent.id),
		]);

		let owed = roundMoney(
			Math.min(
				Number(reversal.total_gross),
				paid - (Number(parent.total_gross) - reversed) - refunded,
			),
		);

		const refundedFrom: number[] = [];

		for (const allocation of allocations) {
			if (owed <= PAYMENT_SETTLED_TOLERANCE) {
				break;
			}

			const movement = await cashFlowService.findById(
				allocation.cash_flow_id,
				false,
			);

			if (movement.direction !== CashFlowDirectionEnum.IN) {
				continue;
			}

			const vatRate = Number(movement.vat_rate);
			const alreadyRefunded = toGrossAmount(
				await cashFlowService.getRefundedAmountSum(movement.id),
				vatRate,
			);

			const amount = roundMoney(
				Math.min(
					owed,
					Number(allocation.amount),
					toGrossAmount(Number(movement.amount), vatRate) -
						alreadyRefunded,
				),
			);

			if (amount <= PAYMENT_SETTLED_TOLERANCE) {
				continue;
			}

			const refund = await cashFlowService.createWithin(manager, {
				direction: CashFlowDirectionEnum.OUT,
				category_type: CashFlowCategoryTypeEnum.CORRECTION,
				category: CashFlowCategoryEnum.REFUND,
				method: movement.method,
				// Net, unscaled: `createWithin` scales it, and the VAT is the movement's own
				amount:
					Math.round(
						(amount / (1 + vatRate / 100)) * 10 ** AMOUNT_DECIMALS,
					) /
					10 ** AMOUNT_DECIMALS,
				vat_rate: vatRate,
				currency: movement.currency,
				// The convention the manual refund follows: the payment's own reference, marked
				external_reference: movement.external_reference
					? `REFUND ${movement.external_reference}`
					: undefined,
				parent_id: movement.id,
				notes: lang('invoice.label.reversal_refund', {
					reference: `${reversal.ref_code}-${reversal.ref_number}`,
				}),
				operational_records: undefined,
			});

			// Paid out as the reversal goes out - see the method note. Completing it through
			// `cash-flow` is what books it on the client ledger, in this same transaction
			const completed = await cashFlowService.completeWithin(
				manager,
				refund,
			);

			await manager.getRepository(InvoicePaymentEntity).save(
				manager.create(InvoicePaymentEntity, {
					invoice_id: reversal.id,
					cash_flow_id: completed.id,
					amount: amount,
					notes: null,
				}),
			);

			refundedFrom.push(movement.id);
			owed = roundMoney(owed - amount);
		}

		if (refundedFrom.length > 0) {
			await this.recomputePaymentStatus(manager, reversal);
		}

		return refundedFrom;
	}

	/** What the original's issued reversals already paid back - their allocations are refunds. */
	private async getRefundedForParent(
		manager: EntityManager,
		parentId: number,
	): Promise<number> {
		const result = await manager
			.getRepository(InvoicePaymentEntity)
			.createQueryBuilder('invoice_payment')
			.innerJoin(
				InvoiceEntity,
				'invoice',
				'invoice.id = invoice_payment.invoice_id AND invoice.deleted_at IS NULL',
			)
			.select('COALESCE(SUM(invoice_payment.amount), 0)', 'refunded')
			.where('invoice.parent_invoice_id = :parentId', {
				parentId: parentId,
			})
			.andWhere('invoice.is_reversal = true')
			.andWhere('invoice.status = :status', {
				status: InvoiceStatusEnum.ISSUED,
			})
			.getRawOne<{ refunded: string }>();

		return roundMoney(Number(result?.refunded ?? 0));
	}

	/** A reversal moved: what it takes off its parent changed with it. */
	private async recomputeParentPaymentStatus(
		manager: EntityManager,
		reversal: InvoiceEntity,
	): Promise<void> {
		if (!reversal.is_reversal || !reversal.parent_invoice_id) {
			return;
		}

		const parent = await manager
			.getRepository(InvoiceEntity)
			.findOneByOrFail({ id: reversal.parent_invoice_id });

		await this.recomputePaymentStatus(manager, parent);
	}

	/**
	 * Withdraws a draft without removing it. Only a draft: an issued document is taken back by a
	 * reversal (`STATUS_TRANSITIONS` allows nothing else), so canceling never has a number, a
	 * ledger entry or an allocation to answer for - a draft holds none of them.
	 */
	public async cancel(entry: InvoiceEntity): Promise<InvoiceEntity> {
		if (entry.status !== InvoiceStatusEnum.DRAFT) {
			throw new CustomError(409, lang('invoice.error.cancel_not_draft'));
		}

		return this.update({
			id: entry.id,
			status: InvoiceStatusEnum.CANCELLED,
		});
	}

	public async findById(
		id: number,
		withDeleted: boolean,
	): Promise<InvoiceWithSources> {
		const invoice = await this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();

		const [withSources] = await this.withSources([invoice]);

		return withSources;
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
	 * Separate reads rather than one join: a document with twenty lines would otherwise repeat the
	 * header - and its two snapshot columns - twenty times over.
	 *
	 * An original's lines also carry what earlier reversals took back of them, which is what a
	 * reversal form defaults to and caps against - and, on a draft, how far each may be restated.
	 */
	public async getEntryData(data: {
		id: number;
	}): Promise<InvoiceWithDetails> {
		const [invoice] = await this.withOutstanding([
			await this.findById(data.id, false),
		]);

		const [lines, payments, reversed] = await Promise.all([
			this.getLines(invoice.id),
			this.getPayments(invoice.id),
			// A reversal is never reversed, so only an original has anything to report here
			invoice.is_reversal
				? Promise.resolve(new Map<number, ReversedLineTotals>())
				: this.getReversedPerLine(invoice.id),
		]);

		// Only a draft can be restated, so an issued document skips the reads
		const isDraft = invoice.status === InvoiceStatusEnum.DRAFT;

		const caps = isDraft
			? await this.getLineCaps(invoice, lines)
			: new Map<number, InvoiceLineCap>();

		const resolvedParties = isDraft
			? {
					resolved_billing_details:
						await this.resolveDraftBillingDetails(invoice),
					resolved_seller_details: this.buildSellerDetails(),
				}
			: {};

		return Object.assign(invoice, {
			lines: lines.map((line) =>
				Object.assign(line, {
					reversed_quantity: reversed.get(line.id)?.quantity ?? 0,
					reversed_net: reversed.get(line.id)?.net ?? 0,
					max_quantity: caps.get(line.id)?.max_quantity ?? null,
					max_unit_price: caps.get(line.id)?.max_unit_price ?? null,
				}),
			),
			payments: payments,
			...resolvedParties,
		});
	}

	public async findByFilter(
		data: ValidatorOutput<InvoiceValidator, 'find'>,
	): Promise<[InvoiceListEntry[], number]> {
		const query = this.repository
			.createQuery()
			.select(ENTRY_COLUMNS)
			.filterById(data.filter.id)
			.filterByTerm(data.filter.term)
			.filterBy('client_id', data.filter.client_id);

		// A source is a row of `invoice_source`, not a column - each filter is a subquery on it
		for (const [sourceType, sourceId] of [
			[InvoiceSourceTypeEnum.ORDER, data.filter.order_id],
			[InvoiceSourceTypeEnum.SUBSCRIPTION, data.filter.subscription_id],
			[InvoiceSourceTypeEnum.SHIPPING, data.filter.shipping_id],
		] as const) {
			if (sourceId) {
				const filter = this.sourceFilter(
					'invoice',
					sourceType,
					sourceId,
				);

				query.filterRaw(filter.condition, filter.parameters);
			}
		}

		query
			.filterBy('parent_invoice_id', data.filter.parent_invoice_id)
			.filterBy('is_reversal', data.filter.is_reversal)
			.filterBy('status', data.filter.status)
			.filterBy('payment_status', data.filter.payment_status)
			.filterBy('scope', data.filter.scope)
			.filterBy('currency', data.filter.currency)
			.filterByOverdue(data.filter.is_overdue)
			.filterByRange(
				'issued_at',
				data.filter.issued_at_start,
				data.filter.issued_at_end,
			);

		query
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit);

		const [entries, total] = await query.all(true);

		const listed = await this.withOrders(
			await this.withOutstanding(
				await this.withReversibleNet(await this.withSources(entries)),
			),
		);

		return [listed, total];
	}

	/**
	 * Puts on each listed document the order it was raised from - its reference and status, what
	 * a listing shows in place of a bare id. One read for the page.
	 */
	private async withOrders<T extends InvoiceWithSources>(
		entries: T[],
	): Promise<(T & { order: InvoiceListOrder | null })[]> {
		const orderIds = [
			...new Set(
				entries
					.map((entry) => entry.order_id)
					.filter((orderId): orderId is number => orderId !== null),
			),
		];

		const orders =
			orderIds.length === 0
				? []
				: await dataSource.getRepository(OrderEntity).find({
						select: {
							id: true,
							ref_code: true,
							ref_number: true,
							status: true,
						},
						where: { id: In(orderIds) },
						withDeleted: true,
					});

		return entries.map((entry) =>
			Object.assign(entry, {
				order:
					orders.find((order) => order.id === entry.order_id) ?? null,
			}),
		);
	}

	/**
	 * Puts on each issued original of a listing the net value still open to a reversal - its net
	 * less what every non-canceled reversal already took back, drafts included, so two reversals
	 * cannot be raised for the same remainder. `null` on anything that cannot be reversed at all.
	 *
	 * What lets a listing offer the reverse action only while there is something left; the
	 * listing carries no lines, and the per-line figures are the detail read's job. One grouped
	 * query for the page, not one per row.
	 */
	/**
	 * Puts on each issued document what it still asks for - `InvoicePaymentService.getOutstanding`
	 * read for the whole page in two grouped queries: its total less its allocations and, on an
	 * original, less its issued reversals. A reversal counts only its allocations, the refunds
	 * paid out against it.
	 *
	 * `null` on a draft or a canceled document, which nothing can be allocated to. Floored at
	 * zero: an original paid in full and then reversed is owed nothing, and the money it is owed
	 * back is the reversal's to refund, not a negative balance on the original.
	 *
	 * Read rather than stored: the total has several writers and the allocations one, so a stored
	 * copy would have to be kept in step at every one of them.
	 */
	private async withOutstanding<T extends InvoiceEntity>(
		entries: T[],
	): Promise<(T & { amount_outstanding: number | null })[]> {
		const issued = entries.filter(
			(entry) => entry.status === InvoiceStatusEnum.ISSUED,
		);

		const issuedIds = issued.map((entry) => entry.id);

		const originalIds = issued
			.filter((entry) => !entry.is_reversal)
			.map((entry) => entry.id);

		const [allocatedRows, reversedRows] = await Promise.all([
			issuedIds.length === 0
				? []
				: this.paymentRepository
						.createQueryBuilder('invoice_payment')
						.select('invoice_payment.invoice_id', 'invoice_id')
						.addSelect(
							'COALESCE(SUM(invoice_payment.amount), 0)',
							'allocated',
						)
						.where('invoice_payment.invoice_id IN (:...ids)', {
							ids: issuedIds,
						})
						.groupBy('invoice_payment.invoice_id')
						.getRawMany<{
							invoice_id: number;
							allocated: string;
						}>(),
			originalIds.length === 0
				? []
				: this.repository
						.createQueryBuilder('reversal')
						.select(
							'reversal.parent_invoice_id',
							'parent_invoice_id',
						)
						.addSelect(
							'COALESCE(SUM(reversal.total_gross), 0)',
							'reversed',
						)
						.where('reversal.parent_invoice_id IN (:...ids)', {
							ids: originalIds,
						})
						.andWhere('reversal.is_reversal = true')
						.andWhere('reversal.status = :status', {
							status: InvoiceStatusEnum.ISSUED,
						})
						.groupBy('reversal.parent_invoice_id')
						.getRawMany<{
							parent_invoice_id: number;
							reversed: string;
						}>(),
		]);

		const allocated = new Map(
			allocatedRows.map((row) => [
				Number(row.invoice_id),
				Number(row.allocated),
			]),
		);

		const reversed = new Map(
			reversedRows.map((row) => [
				Number(row.parent_invoice_id),
				Number(row.reversed),
			]),
		);

		return entries.map((entry) =>
			Object.assign(entry, {
				amount_outstanding: issuedIds.includes(entry.id)
					? roundMoney(
							Math.max(
								0,
								Number(entry.total_gross) -
									(allocated.get(entry.id) ?? 0) -
									(reversed.get(entry.id) ?? 0),
							),
						)
					: null,
			}),
		);
	}

	private async withReversibleNet<T extends InvoiceEntity>(
		entries: T[],
	): Promise<(T & { reversible_net: number | null })[]> {
		const reversibleIds = entries
			.filter(
				(entry) =>
					!entry.is_reversal &&
					entry.status === InvoiceStatusEnum.ISSUED,
			)
			.map((entry) => entry.id);

		const rows =
			reversibleIds.length === 0
				? []
				: await this.repository
						.createQueryBuilder('reversal')
						.select(
							'reversal.parent_invoice_id',
							'parent_invoice_id',
						)
						.addSelect(
							'COALESCE(SUM(reversal.total_net), 0)',
							'reversed_net',
						)
						.where('reversal.parent_invoice_id IN (:...ids)', {
							ids: reversibleIds,
						})
						.andWhere('reversal.is_reversal = true')
						.andWhere('reversal.status <> :canceled', {
							canceled: InvoiceStatusEnum.CANCELLED,
						})
						.groupBy('reversal.parent_invoice_id')
						.getRawMany<{
							parent_invoice_id: number;
							reversed_net: string;
						}>();

		const reversedNet = new Map(
			rows.map((row) => [
				Number(row.parent_invoice_id),
				Number(row.reversed_net),
			]),
		);

		return entries.map((entry) =>
			Object.assign(entry, {
				reversible_net: reversibleIds.includes(entry.id)
					? roundMoney(
							Math.max(
								0,
								Number(entry.total_net) -
									(reversedNet.get(entry.id) ?? 0),
							),
						)
					: null,
			}),
		);
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
	 * The buyer as the order names them: their own client columns, and the order's own billing
	 * address - the snapshot checkout copied and an operator may have corrected since. An order
	 * with none has nowhere to send the document, so it is refused until the operator fills it in.
	 */
	/**
	 * The buyer a draft would be issued to with nothing stated by hand. An order the buyer cannot
	 * be resolved from yet - no billing address, no country - answers `null` rather than the 409
	 * issuing raises: on a read it only means the form starts empty.
	 */
	private async resolveDraftBillingDetails(
		invoice: InvoiceWithSources,
	): Promise<BillingDetails | null> {
		if (!invoice.order_id) {
			return invoice.billing_details;
		}

		try {
			return await this.buildBillingDetailsForOrder(
				await orderService.findById(invoice.order_id, false),
			);
		} catch (error) {
			if (error instanceof CustomError && error.statusCode === 409) {
				return null;
			}

			throw error;
		}
	}

	private async buildBillingDetailsForOrder(
		order: OrderEntity,
	): Promise<BillingDetails> {
		if (!order.billing_address) {
			throw new CustomError(
				409,
				lang('invoice.error.billing_address_required'),
			);
		}

		return this.buildBillingDetails(order.client_id, order.billing_address);
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
