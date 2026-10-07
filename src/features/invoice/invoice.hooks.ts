import { createKeyedProvider, createNotification } from '@/helpers/hook.helper';

/**
 * What `invoice` announces once its own writes have committed, and what it asks of the features
 * whose rows it bills.
 *
 * ## The invoice-first chain
 *
 * The shop's happy path runs **invoice first**: a checkout raises the order `pending` together
 * with its documents, a captured payment is allocated against the client's oldest open documents,
 * and the order is moved along once everything it was billed for is settled - `confirmed` when its
 * documents are paid, `completed` when its deliveries have also arrived.
 *
 * Every step lives in the feature that owns the rows it writes, and none of the writers imports
 * the next: `cash_flow` stays a ledger with no document coupling, `cart`, `order` and `shipping`
 * know nothing about invoices. Each of them declares the hooks it raises in its own `*.hooks.ts`
 * (`order.hooks.ts`, `cash-flow.hooks.ts`, `shipping.hooks.ts`), and the feature acting on them
 * depends on it and registers from its bootstrap:
 *
 * - `invoice` - the billing side: raises documents for a placed or confirmed order and a new
 *   movement, and spreads a captured payment over the client's documents. It then announces the
 *   orders whose standing it may have moved (`notifyOrderStateChanged`, below).
 * - `order-settlement` - the order side: re-reads each announced order and moves it to the status
 *   its documents and deliveries justify. Optional - without it orders are billed and paid the
 *   same, and only move status by hand.
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
 * ## Billable sources
 *
 * What an order carries besides its goods that is billed on a document of its own - a movement of
 * goods, a subscription. `invoice` keeps everything generic: whether a source is already billed
 * (read from `invoice_source`), numbering, parties, settlement. What a source *is* - which rows of
 * an order are billable at all, what lines bill one, how far an operator may edit those lines - is
 * answered by a provider per `invoice_source.source_type`, so a new provider also adds that enum
 * value.
 *
 * A feature depending on `invoice` registers its provider from its own bootstrap
 * (`subscription.bootstrap.ts`). One `invoice` itself depends on is registered by `invoice` from
 * `sources/` (`sources/shipping.source.ts`) - the feature cannot import back.
 *
 * **Optional per type.** With the owning feature absent nothing is registered: its sources are
 * never raised automatically, and a document of that type is refused rather than raised blind.
 *
 * Awaited by the caller, read-only, outside any transaction - a provider reads its own rows and
 * writes nothing.
 */

/**
 * What an order's settlement reads has just moved - a document raised or paid, a payment
 * allocated, a delivery moved along - for these orders. Sent for every order `invoice` touched,
 * whether or not anything changed for it.
 */
export type OrderStateChangedPayload = {
	order_ids: readonly number[];
};

/** One line a source is billed with, before `invoice` computes its net, VAT and total. */
export type BillableLine = {
	label: string;
	quantity: number;
	unit_price: number;
	vat_rate: number;
	discount_reduction: number; // Money already taken off the line, kept out of its net
};

/** A row an order carries that bills on a document of its own. */
export type BillableSource = {
	id: number;
	order_id: number;
	lines: readonly BillableLine[];
};

/** How far a line billing a source may be edited on a draft. */
export type BillableLineCap = {
	max_quantity: number;
	max_unit_price: number;
};

export type BillableSourceProvider = {
	/**
	 * True when a row is billed by one live document at most - a movement's fee. False when it is
	 * billed repeatedly - a subscription, once per period.
	 */
	billedOnce: boolean;

	/**
	 * The rows of an order billed automatically when the order is - each raised on its own document
	 * unless one already bills it. Empty for a type raised only by hand.
	 */
	listBillable(orderId: number): Promise<BillableSource[]>;

	/** One row, or null when it does not exist or cannot be billed at all. */
	findBillable(sourceId: number): Promise<BillableSource | null>;

	/**
	 * The edit ceiling of the lines billing these rows, by row id. Read for documents already
	 * raised, so a row since deleted or no longer billable still answers; one absent from the map is
	 * not capped.
	 */
	getLineCaps(
		sourceIds: readonly number[],
	): Promise<Map<number, BillableLineCap>>;
};

const orderStateChanged = createNotification<OrderStateChangedPayload>(
	'Failed to settle orders against their documents and deliveries',
);

const billableSources = createKeyedProvider<BillableSourceProvider>();

export const registerOrderStateChangedHandler = orderStateChanged.register;

export const notifyOrderStateChanged = (
	payload: OrderStateChangedPayload,
): Promise<void> => {
	if (payload.order_ids.length === 0) {
		return Promise.resolve();
	}

	return orderStateChanged.notify(payload);
};

/** One provider per source type; `null` unregisters it, which is what a test resets to. */
export const registerBillableSourceProvider = billableSources.register;

/** The provider of a source type, or null when the feature owning it is not installed. */
export const getBillableSourceProvider = billableSources.get;
