import { getSystemLogger } from '@/providers/logger.provider';

/**
 * What happens downstream when money moves and when an order is accepted.
 *
 * Two hooks, running in the same direction as the shop's happy path: a customer payment completes,
 * the order it was raised for is confirmed, and confirming the order raises the charge for it.
 * Each step lives in the feature that owns the rows it writes, and neither imports the next -
 * `cash_flow` stays a ledger with no document coupling, and `order` knows nothing about invoices.
 *
 * The dependency runs the way `target-participation.registry.ts` runs it: the feature that acts
 * registers a handler here, and the feature that has just written something asks the registry
 * rather than the feature. Nothing in this file imports a feature.
 *
 * **Every notification runs after its own write has committed, never inside its transaction.**
 * The chain crosses three features and each link opens transactions of its own - `invoice` raising
 * a charge allocates a series number and writes lines. Handing a caller's `EntityManager` down a
 * chain that deep would either nest transactions on a second connection or hold one open across
 * the whole thing.
 *
 * **A failing handler is logged, never rethrown.** The write that triggered it is already
 * committed and cannot be taken back by a throw, so propagating would only hand a gateway webhook
 * a 500 to retry against a status transition that now refuses it. What is left behind is always a
 * state an operator can finish by hand: a completed payment against an order still `pending`, or a
 * confirmed order with no invoice yet.
 *
 * Handlers are registered from `*.bootstrap.ts`, which `bootstrap.setup.ts` runs before the server
 * listens. That step is skipped in the `test` environment, so the registry is empty there and a
 * test covering one of these steps registers its own handler.
 */

/**
 * A customer payment has just been captured, and it was raised for an order.
 *
 * Only movements carrying an `order` operational record are announced - a payment recorded against
 * a client with no document behind it settles nothing on its own.
 */
export type CashFlowSettledPayload = {
	cash_flow_id: number;
	order_id: number;
};

/**
 * An order has just been accepted, whoever accepted it - a captured payment or an operator.
 *
 * `cash_flow_id` names the movement that caused it, so the charge raised downstream can be
 * settled by the same money in one step. It is null when an operator confirmed the order by hand,
 * which is the back-office path and the cash-on-delivery one: the invoice is raised all the same
 * and stays `unpaid` until a movement is allocated to it.
 */
export type OrderConfirmedPayload = {
	order_id: number;
	cash_flow_id: number | null;
};

type SettlementHandler<TPayload> = (payload: TPayload) => Promise<void>;

let cashFlowSettledHandler: SettlementHandler<CashFlowSettledPayload> | null =
	null;

let orderConfirmedHandler: SettlementHandler<OrderConfirmedPayload> | null =
	null;

/**
 * Registering twice replaces the previous handler rather than adding a second opinion - there is
 * one feature that owns each step, and a duplicate registration is a reload, not a second rule.
 */
export const registerCashFlowSettledHandler = (
	handler: SettlementHandler<CashFlowSettledPayload>,
): void => {
	cashFlowSettledHandler = handler;
};

export const registerOrderConfirmedHandler = (
	handler: SettlementHandler<OrderConfirmedPayload>,
): void => {
	orderConfirmedHandler = handler;
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

export const notifyCashFlowSettled = (
	payload: CashFlowSettledPayload,
): Promise<void> => {
	return notify(
		cashFlowSettledHandler,
		payload,
		'Failed to settle the order behind a captured payment',
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
