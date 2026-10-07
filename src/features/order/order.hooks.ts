import { createNotification, createQuery } from '@/helpers/hook.helper';

/**
 * What `order` announces about its own rows, and what it asks before rewriting one - answered by
 * whichever feature bills orders (`invoice`), which depends on `order` and registers from its
 * bootstrap. See `invoice.hooks.ts` for the invoice-first chain these steps belong to.
 *
 * Without a registered handler an order is placed, confirmed and edited the same, and nothing
 * bills it.
 */

/** A checkout has just written an order, its shipping and the payment request for it. */
export type OrderPlacedPayload = {
	order_id: number;
};

/**
 * An order has just been accepted, whoever accepted it - settled documents or an operator.
 *
 * The back-office path is the one this exists for: an order typed up by an operator has no
 * checkout to raise its documents, so accepting it is what bills whatever is still unbilled. On the
 * checkout path the documents are already raised and the handler finds nothing left to bill.
 */
export type OrderConfirmedPayload = {
	order_id: number;
};

const orderPlaced = createNotification<OrderPlacedPayload>(
	'Failed to raise the invoices for a placed order',
);

const orderConfirmed = createNotification<OrderConfirmedPayload>(
	'Failed to raise the invoice for a confirmed order',
);

/*
 * Unlike the notifications this one propagates a failure: it gates a write the caller has not
 * made yet, and answering `false` on an error would let lines be rewritten under an issued invoice.
 */
const orderInvoiced = createQuery<[orderId: number], boolean>(() => false);

export const registerOrderPlacedHandler = orderPlaced.register;
export const notifyOrderPlaced = orderPlaced.notify;

export const registerOrderConfirmedHandler = orderConfirmed.register;
export const notifyOrderConfirmed = orderConfirmed.notify;

export const registerOrderInvoicedResolver = orderInvoiced.register;

/**
 * Asked before rewriting a pending order's lines. With no resolver - the invoice feature absent,
 * or the `test` environment - nothing has billed the order and the answer is `false`.
 */
export const isOrderInvoiced = orderInvoiced.ask;
