import type { EntityManager } from 'typeorm';
import { createNotification, createQuery } from '@/helpers/hook.helper';

/**
 * What `order` announces about its own rows, and what it asks before and while rewriting one -
 * answered by whichever feature bills orders (`invoice`) or raised the order's payment (`cart`),
 * each of which depends on `order` and registers from its bootstrap. See `invoice.hooks.ts` for the
 * chain these steps belong to.
 *
 * Without a registered handler an order is placed, confirmed and edited the same, and nothing
 * bills it.
 */

/** A checkout has just written an order, its shipping and the payment request for it. */
export type OrderPlacedPayload = {
	order_id: number;
};

/**
 * An order has just been accepted, whoever accepted it - a payment that covers it or an operator.
 *
 * Accepting is what bills an order, on either path: a pending order is still editable, so neither
 * a checkout nor the back office raises its documents before this.
 */
export type OrderConfirmedPayload = {
	order_id: number;
};

const orderPlaced = createNotification<OrderPlacedPayload>(
	'A handler failed for a placed order',
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

/*
 * Propagates for the reason `orderInvoiced` does: it gates a write, and answering `false` on an
 * error would move an order away from the client its documents and money belong to.
 */
const orderClientLocked = createQuery<[orderId: number], boolean>(() => false);

export const registerOrderClientLockedResolver = orderClientLocked.register;

/**
 * Asked before an order is moved to another client. True once anything is held under the client
 * the order names - a live goods document, which is raised for that client, or a payment filed
 * under it. With no resolver nothing has been billed or paid and the answer is `false`.
 */
export const isOrderClientLocked = orderClientLocked.ask;

/**
 * Work to run once the transaction that rewrote the lines has committed - dropping a cache, which
 * must not happen inside it (see `rules/database.md` §6).
 */
export type AfterCommit = () => Promise<void>;

/*
 * Asked **inside** the transaction that rewrites a pending order's lines, with its manager, so a
 * payment request that follows the order total moves with the lines or not at all. Propagates: a
 * failure rolls the line edit back rather than leaving the request asking for the old total.
 */
const orderPaymentSync = createQuery<
	[manager: EntityManager, orderId: number],
	AfterCommit | null
>(() => null);

export const registerOrderPaymentSync = orderPaymentSync.register;

/**
 * Brings the payment request still pending for an order in line with what it now costs. Answered
 * by `cart`, which raised that request at checkout; with nothing registered - a back-office order
 * has no request to follow it - nothing moves.
 */
export const syncOrderPayment = orderPaymentSync.ask;
