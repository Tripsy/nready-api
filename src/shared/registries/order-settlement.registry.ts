import { getSystemLogger } from '@/providers/logger.provider';

/**
 * What happens downstream when an order is placed, money moves or a parcel changes state.
 *
 * The shop's happy path runs **invoice first**: a checkout raises the order `pending` together
 * with its documents, a captured payment is allocated against the client's oldest open documents,
 * and the order is moved along once everything it was billed for is settled - `confirmed` when its
 * documents are paid, `completed` when its deliveries have also arrived.
 *
 * Every step lives in the feature that owns the rows it writes, and none of the writers imports
 * the next: `cash_flow` stays a ledger with no document coupling, `cart`, `order` and `shipping`
 * know nothing about invoices. Two features register:
 *
 * - `invoice` - the billing side: raises documents for a placed or confirmed order and a new
 *   movement, and spreads a captured payment over the client's documents. It then announces the
 *   orders whose standing it may have moved (`notifyOrderStateChanged`).
 * - `order-settlement` - the order side: re-reads each announced order and moves it to the status
 *   its documents and deliveries justify. Optional - without it orders are billed and paid the
 *   same, and only move status by hand.
 *
 * The dependency runs the way `target-participation.registry.ts` runs it: the feature that acts
 * registers a handler here, and the feature that has just written something asks the registry
 * rather than the feature. Nothing in this file imports a feature.
 *
 * **Every notification runs after its own write has committed, never inside its transaction.**
 * The chain crosses several features and each link opens transactions of its own - raising a
 * document allocates a series number and writes lines. Handing a caller's `EntityManager` down a
 * chain that deep would either nest transactions on a second connection or hold one open across
 * the whole thing.
 *
 * **A failing handler is logged, never rethrown.** The write that triggered it is already
 * committed and cannot be taken back by a throw, so propagating would only hand a gateway webhook
 * a 500 to retry against a status transition that now refuses it. What is left behind is always a
 * state an operator can finish by hand - a completed payment not yet allocated, a pending order
 * with no invoice yet - and `client-ledger-reconcile.cron.ts` writes any ledger entry a failed
 * handler skipped.
 *
 * Handlers are registered from `*.bootstrap.ts`, which `bootstrap.setup.ts` runs before the server
 * listens. That step is skipped in the `test` environment, so the registry is empty there and a
 * test covering one of these steps registers its own handler.
 */

/** A checkout has just written an order, its shipping and the payment request for it. */
export type OrderPlacedPayload = {
	order_id: number;
};

/**
 * A movement has just been captured.
 *
 * Announced for every movement filed under a client, not only for one raised for an order: money
 * is allocated against the client's documents oldest first, so a deposit settles an open invoice
 * the same way a checkout payment does.
 */
export type CashFlowCompletedPayload = {
	cash_flow_id: number;
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

/**
 * A movement of goods has just been written or moved along. `order_id` is null on a `relocation`,
 * which bills nobody and is announced only so the payload never has to be filtered by the sender.
 */
export type ShippingChangedPayload = {
	shipping_id: number;
	order_id: number | null;
};

/**
 * What an order's settlement reads has just moved - a document raised or paid, a payment
 * allocated, a delivery moved along - for these orders. Sent by `invoice` once its own writes have
 * committed, for every order it touched, whether or not anything changed for it.
 */
export type OrderStateChangedPayload = {
	order_ids: readonly number[];
};

type SettlementHandler<TPayload> = (payload: TPayload) => Promise<void>;

/** Whether an order already has a live document billing its lines. */
export type OrderInvoicedResolver = (orderId: number) => Promise<boolean>;

let orderPlacedHandler: SettlementHandler<OrderPlacedPayload> | null = null;

let cashFlowCompletedHandler: SettlementHandler<CashFlowCompletedPayload> | null =
	null;

let orderConfirmedHandler: SettlementHandler<OrderConfirmedPayload> | null =
	null;

let shippingChangedHandler: SettlementHandler<ShippingChangedPayload> | null =
	null;

let orderStateChangedHandler: SettlementHandler<OrderStateChangedPayload> | null =
	null;

let orderInvoicedResolver: OrderInvoicedResolver | null = null;

/*
 * Registering twice replaces the previous handler rather than adding a second opinion - there is
 * one feature that owns each step, and a duplicate registration is a reload, not a second rule.
 */
export const registerOrderPlacedHandler = (
	handler: SettlementHandler<OrderPlacedPayload>,
): void => {
	orderPlacedHandler = handler;
};

export const registerCashFlowCompletedHandler = (
	handler: SettlementHandler<CashFlowCompletedPayload>,
): void => {
	cashFlowCompletedHandler = handler;
};

export const registerOrderConfirmedHandler = (
	handler: SettlementHandler<OrderConfirmedPayload>,
): void => {
	orderConfirmedHandler = handler;
};

export const registerShippingChangedHandler = (
	handler: SettlementHandler<ShippingChangedPayload>,
): void => {
	shippingChangedHandler = handler;
};

export const registerOrderStateChangedHandler = (
	handler: SettlementHandler<OrderStateChangedPayload>,
): void => {
	orderStateChangedHandler = handler;
};

export const registerOrderInvoicedResolver = (
	resolver: OrderInvoicedResolver,
): void => {
	orderInvoicedResolver = resolver;
};

const notify = async <TPayload>(
	handler: SettlementHandler<TPayload> | null,
	payload: TPayload,
	message: string,
): Promise<void> => {
	if (!handler) {
		return;
	}

	try {
		await handler(payload);
	} catch (error) {
		// The payload is nested rather than spread: it is generic here, and PINO's typing reads a
		// spread of it as possibly being the message argument
		getSystemLogger().error({ err: error, payload: payload }, message);
	}
};

export const notifyOrderPlaced = (
	payload: OrderPlacedPayload,
): Promise<void> => {
	return notify(
		orderPlacedHandler,
		payload,
		'Failed to raise the invoices for a placed order',
	);
};

export const notifyCashFlowCompleted = (
	payload: CashFlowCompletedPayload,
): Promise<void> => {
	return notify(
		cashFlowCompletedHandler,
		payload,
		'Failed to record and allocate a captured payment',
	);
};

export const notifyOrderConfirmed = (
	payload: OrderConfirmedPayload,
): Promise<void> => {
	return notify(
		orderConfirmedHandler,
		payload,
		'Failed to raise the invoice for a confirmed order',
	);
};

export const notifyShippingChanged = (
	payload: ShippingChangedPayload,
): Promise<void> => {
	return notify(
		shippingChangedHandler,
		payload,
		'Failed to bill or settle the order behind a shipping change',
	);
};

export const notifyOrderStateChanged = (
	payload: OrderStateChangedPayload,
): Promise<void> => {
	if (payload.order_ids.length === 0) {
		return Promise.resolve();
	}

	return notify(
		orderStateChangedHandler,
		payload,
		'Failed to settle orders against their documents and deliveries',
	);
};

/**
 * Asked by `order` before rewriting a pending order's lines. With no resolver - the invoice feature
 * absent, or the `test` environment - nothing has billed the order and the answer is `false`.
 *
 * Unlike the notifications this one propagates a failure: it gates a write the caller has not
 * made yet, and answering `false` on an error would let lines be rewritten under an issued invoice.
 */
export const isOrderInvoiced = (orderId: number): Promise<boolean> => {
	if (!orderInvoicedResolver) {
		return Promise.resolve(false);
	}

	return orderInvoicedResolver(orderId);
};
