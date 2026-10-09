import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { cashFlowService } from '@/features/cash-flow/cash-flow.service';
import InvoiceEntity, {
	InvoicePaymentStatusEnum,
	InvoiceStatusEnum,
	PAYMENT_SETTLED_TOLERANCE,
} from '@/features/invoice/invoice.entity';
import { invoiceService } from '@/features/invoice/invoice.service';
import { InvoiceSourceTypeEnum } from '@/features/invoice/invoice-source.entity';
import {
	type OrderStatus,
	OrderStatusEnum,
} from '@/features/order/order.entity';
import { orderService } from '@/features/order/order.service';
import ProductEntity, {
	ProductTypeEnum,
} from '@/features/product/product.entity';
import ShippingEntity, {
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import { shippingService } from '@/features/shipping/shipping.service';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import { getSystemLogger } from '@/providers/logger.provider';

/**
 * Where an order stands against what it was billed and what has arrived.
 *
 * - `fully_invoiced` - every order line billed to its full quantity, and every row a provider
 *   bills automatically (`InvoiceService.getUnbilledSources` - a priced movement of goods) billed
 *   by a document of its own.
 * - `all_paid` - at least one live billing document, every one of them issued and settled.
 * - `delivered` - no delivery still under way, and the delivered quantities cover every physical
 *   line of the order.
 */
export type OrderSettlementState = {
	fully_invoiced: boolean;
	all_paid: boolean;
	delivered: boolean;
};

/**
 * Moves an order along once it is paid for, and once what it was billed for is settled.
 *
 * The order's own status machine runs one way (`order.entity.ts`), and so does this: a `pending`
 * order with no goods document yet is confirmed once the money captured for it covers what it
 * costs - confirming is what bills it; a `pending` one already billed is confirmed once its
 * documents are all paid; a `confirmed` one whose goods have also all arrived is completed. Nothing here moves an order back - a document raised later, a payment
 * removed - and nothing touches a `canceled` order. Those are an operator's to resolve.
 *
 * Its own feature, reached only through `invoice.hooks.ts`: `invoice` announces the
 * orders its billing and allocation touched (`notifyOrderStateChanged`), and this feature's
 * bootstrap re-reads them. It reads invoices, order lines, products and deliveries, and moves the
 * order through `order`'s own service. Optional - without it orders are billed and paid the same,
 * and change status by hand only.
 */
export class OrderSettlementService {
	/**
	 * @description Used by the order-state-changed handler in `order-settlement.bootstrap.ts`
	 *
	 * Every order once, and each on its own: one order refusing a transition must not keep the
	 * others behind it from being read. A failure is logged, the way the settlement registry logs
	 * a failed handler - the write that led here has already committed.
	 */
	public async evaluateMany(
		orderIds: readonly (number | null)[],
	): Promise<void> {
		for (const orderId of new Set(orderIds)) {
			if (!orderId) {
				continue;
			}

			try {
				await this.evaluate(orderId);
			} catch (error) {
				getSystemLogger().error(
					{ err: error, order_id: orderId },
					'Failed to settle an order against its documents',
				);
			}
		}
	}

	/**
	 * @description Moves the order to the status its documents and deliveries justify, if any
	 *
	 * Returns the status the order was moved to, or null when it stays where it is.
	 */
	public async evaluate(orderId: number): Promise<OrderStatus | null> {
		const order = await orderService.findById(orderId, false);

		if (
			order.status !== OrderStatusEnum.PENDING &&
			order.status !== OrderStatusEnum.CONFIRMED
		) {
			return null;
		}

		/*
		 * Not billed yet - every order since checkout stopped billing at placement. The money
		 * captured for it is what decides: once it covers the order, confirming bills it, and the
		 * handler that raises the documents spreads that money over them and announces the order
		 * again, which brings it back here as billed.
		 */
		if (
			order.status === OrderStatusEnum.PENDING &&
			!(await invoiceService.hasLiveOrderInvoice(orderId))
		) {
			if (!(await this.isPrepaid(orderId))) {
				return null;
			}

			await orderService.updateStatus(order, OrderStatusEnum.CONFIRMED);

			return OrderStatusEnum.CONFIRMED;
		}

		const state = await this.getState(orderId);

		if (!state.fully_invoiced || !state.all_paid) {
			return null;
		}

		/*
		 * Confirming is announced to `invoice` like an operator's confirm - and finds nothing
		 * left to bill, since being fully invoiced is what let it through.
		 */
		if (order.status === OrderStatusEnum.PENDING) {
			await orderService.updateStatus(order, OrderStatusEnum.CONFIRMED);

			if (!state.delivered) {
				return OrderStatusEnum.CONFIRMED;
			}
		}

		if (!state.delivered) {
			return null;
		}

		await orderService.updateStatus(order, OrderStatusEnum.COMPLETED);

		return OrderStatusEnum.COMPLETED;
	}

	/**
	 * Whether the money captured for an order covers what the buyer was asked for - its goods and
	 * its priced deliveries, gross - within the tolerance a settled document is read with. An order
	 * that costs nothing is not "paid" by nobody paying: it waits for an operator.
	 */
	private async isPrepaid(orderId: number): Promise<boolean> {
		const [paid, payable] = await Promise.all([
			cashFlowService.sumCompletedForOrder(orderId),
			shippingService.computeOrderPayable(orderId),
		]);

		return payable > 0 && paid >= payable - PAYMENT_SETTLED_TOLERANCE;
	}

	public async getState(orderId: number): Promise<OrderSettlementState> {
		const [orderLines, billedQuantities, unbilledSources] =
			await Promise.all([
				orderService.getLines(orderId),
				invoiceService.getBilledQuantities(orderId),
				invoiceService.getUnbilledSources(orderId),
			]);

		const linesBilled = orderLines.every(
			(line) =>
				Number(line.quantity) - (billedQuantities.get(line.id) ?? 0) <=
				0,
		);

		return {
			fully_invoiced: linesBilled && unbilledSources.length === 0,
			all_paid: await this.isPaid(orderId),
			delivered: await this.isDelivered(orderId, orderLines),
		};
	}

	/**
	 * Every live billing document of the order issued and settled. A draft holds the order back:
	 * it bills part of the order and nobody has been asked to pay it yet. A document worth nothing
	 * - a zero-priced line, a document reversed in full - asks for nothing and counts as settled.
	 * Reversals themselves are left out: they are settled by refunds, which the order does not
	 * wait on.
	 */
	private async isPaid(orderId: number): Promise<boolean> {
		const ids = await invoiceService.findIdsBySource(
			InvoiceSourceTypeEnum.ORDER,
			orderId,
		);

		const documents =
			ids.length === 0
				? []
				: await dataSource.getRepository(InvoiceEntity).find({
						select: {
							id: true,
							status: true,
							payment_status: true,
							total_gross: true,
						},
						where: {
							id: In(ids),
							is_reversal: false,
						},
					});

		const live = documents.filter(
			(document) => document.status !== InvoiceStatusEnum.CANCELED,
		);

		return (
			live.length > 0 &&
			live.every(
				(document) =>
					document.status === InvoiceStatusEnum.ISSUED &&
					(document.payment_status ===
						InvoicePaymentStatusEnum.PAID ||
						Number(document.total_gross) <=
							PAYMENT_SETTLED_TOLERANCE),
			)
		);
	}

	/**
	 * Nothing still traveling, and what arrived covers what was bought.
	 *
	 * Only physical lines are expected to travel - a digital product or a service never ships -
	 * and a bundle header is not a parcel of its own: its components are, the same split the
	 * checkout uses when it writes the first delivery (`toShippingLines` in `cart.service.ts`).
	 * Quantities are compared per variant, because that is what a shipping line names.
	 */
	private async isDelivered(
		orderId: number,
		orderLines: Awaited<ReturnType<typeof orderService.getLines>>,
	): Promise<boolean> {
		const deliveries = await dataSource.getRepository(ShippingEntity).find({
			select: { id: true, status: true },
			where: { order_id: orderId, scope: ShippingScopeEnum.DELIVERY },
		});

		const underWay = deliveries.some(
			(delivery) =>
				delivery.status !== ShippingStatusEnum.DELIVERED &&
				delivery.status !== ShippingStatusEnum.FAILED &&
				delivery.status !== ShippingStatusEnum.RETURNED &&
				delivery.status !== ShippingStatusEnum.CANCELED,
		);

		if (underWay) {
			return false;
		}

		const bundleIds = new Set(
			orderLines
				.map((line) => line.parent_id)
				.filter((parentId): parentId is number => parentId !== null),
		);

		const candidates = orderLines.filter((line) => !bundleIds.has(line.id));

		const productIds = [
			...new Set(candidates.map((line) => line.product_id)),
		];

		const physical =
			productIds.length === 0
				? new Set<number>()
				: new Set(
						(
							await dataSource.getRepository(ProductEntity).find({
								select: { id: true },
								where: {
									id: In(productIds),
									type: ProductTypeEnum.PHYSICAL,
								},
								withDeleted: true,
							})
						).map((product) => product.id),
					);

		const orderedByVariant = new Map<number, number>();

		for (const line of candidates) {
			if (!physical.has(line.product_id)) {
				continue;
			}

			orderedByVariant.set(
				line.variant_id,
				(orderedByVariant.get(line.variant_id) ?? 0) +
					Number(line.quantity),
			);
		}

		if (orderedByVariant.size === 0) {
			return true;
		}

		const delivered = await dataSource
			.getRepository(ShippingLineEntity)
			.createQueryBuilder('line')
			.innerJoin(
				ShippingEntity,
				'shipping',
				'shipping.id = line.shipping_id AND shipping.deleted_at IS NULL',
			)
			.select('line.variant_id', 'variant_id')
			.addSelect('SUM(line.quantity)', 'quantity')
			.where('shipping.order_id = :orderId', { orderId: orderId })
			.andWhere('shipping.scope = :scope', {
				scope: ShippingScopeEnum.DELIVERY,
			})
			.andWhere('shipping.status = :status', {
				status: ShippingStatusEnum.DELIVERED,
			})
			.groupBy('line.variant_id')
			.getRawMany<{ variant_id: number; quantity: string }>();

		const deliveredByVariant = new Map(
			delivered.map((row) => [
				Number(row.variant_id),
				Number(row.quantity),
			]),
		);

		return [...orderedByVariant].every(
			([variantId, quantity]) =>
				(deliveredByVariant.get(variantId) ?? 0) >= quantity,
		);
	}
}

export const orderSettlementService = new OrderSettlementService();
