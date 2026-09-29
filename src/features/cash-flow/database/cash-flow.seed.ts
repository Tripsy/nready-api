import type { EntityManager } from 'typeorm';
import {
	isDirectRun,
	type Random,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import CashFlowEntity, {
	AMOUNT_DECIMALS,
	CashFlowCategoryTypeEnum,
	CashFlowDirectionEnum,
	type CashFlowMethod,
	CashFlowMethodEnum,
	CashFlowStatusEnum,
	getExpectedCategoryType,
	getExpectedDirection,
} from '@/features/cash-flow/cash-flow.entity';
import {
	type CashFlowCategory,
	CashFlowCategoryEnum,
} from '@/features/cash-flow/cash-flow-category.enum';
import OperationalRecordEntity, {
	OperationalRecordTypeEnum,
} from '@/features/cash-flow/operational-record.entity';
import { resolveBaseCurrency } from '@/features/exchange-rate/exchange-rate.entity';

const TARGET = 150;

/** How many months back the rows are spread, counting the current one. */
const MONTH_SPREAD = 6;

/**
 * Only the categories `getExpectedCategoryType` actually classifies - the enum carries
 * fleet-specific values (`fuel`, `tolls`, the `employee_*` family) that this project does
 * not map, and passing one in would throw `Unknown category`.
 *
 * `refund` is classified but still absent: the table's CHECK constraint only allows
 * `category_type = 'correction'` on a row that has a `parent_id`, and this seed creates no
 * parent/child pairs.
 */
const CATEGORY_POOL: readonly CashFlowCategory[] = [
	CashFlowCategoryEnum.SALE,
	CashFlowCategoryEnum.SALE,
	CashFlowCategoryEnum.SALE,
	CashFlowCategoryEnum.SALE,
	CashFlowCategoryEnum.VENDOR,
	CashFlowCategoryEnum.VENDOR,
	CashFlowCategoryEnum.INSURANCE,
	CashFlowCategoryEnum.TAXES,
];

/** Plausible value band per seeded category, in whole currency units. */
const AMOUNT_RANGES: Partial<
	Record<CashFlowCategory, readonly [number, number]>
> = {
	[CashFlowCategoryEnum.SALE]: [80, 4500],
	[CashFlowCategoryEnum.VENDOR]: [100, 3000],
	[CashFlowCategoryEnum.INSURANCE]: [400, 3500],
	[CashFlowCategoryEnum.TAXES]: [300, 6000],
};

const VAT_RATES = [0, 5, 9, 19, 21] as const;

/**
 * Rate against the base currency; only a foreign-currency row carries anything but 1. Keyed by
 * ISO code, so a deployment based on a currency not listed here seeds every row at 1.
 */
const EXCHANGE_RATES: Record<string, number> = {
	RON: 1,
	EUR: 5.08,
	USD: 4.66,
};

/**
 * A moment inside the month `index` falls into, spreading the rows evenly over the last
 * `MONTH_SPREAD` months. Without this every row carries the instant the seed ran, so any
 * month-over-month figure - the dashboard's revenue and expense trend - divides by an empty
 * previous month and can only ever report a no-baseline +/-100%.
 *
 * The current month stops at today: a cash flow dated in the future is not something the app
 * should ever be asked to render.
 */
function createdAtForIndex(random: Random, index: number): Date {
	const now = new Date();
	const monthsAgo = index % MONTH_SPREAD;

	const year = now.getFullYear();
	const month = now.getMonth() - monthsAgo;

	// Day 0 of the following month is the last day of this one, which keeps a 31 from rolling
	// over into the next month when the target month is shorter.
	const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
	const maxDay = monthsAgo === 0 ? now.getDate() : lastDayOfMonth;

	return new Date(
		year,
		month,
		randomInt(random, 1, maxDay),
		randomInt(random, 8, 19),
		randomInt(random, 0, 59),
		randomInt(random, 0, 59),
	);
}

/**
 * An order still waiting to be paid for, with what it is worth to the buyer.
 *
 * Read with plain SQL rather than through the order entities, because this feature does not import
 * `order` - in production a movement reaches its document through an `operational_record` id and
 * nothing more, and a seed reaching across would be the one place that claim stops being true.
 *
 * `total_gross` is the arithmetic `OrderService.computeTotals` and `InvoiceService.computeLine`
 * perform: VAT per line, applied after the discount, plus the delivery priced the same way. A
 * failed shipment carried nothing and is not billed.
 */
type PayableOrderRow = {
	order_id: number;
	client_id: number;
	payment_method: string | null;
	created_at: Date;
	currency: string | null;
	exchange_rate: string | null;
	total_gross: string;
};

const PAYABLE_ORDERS_QUERY = `
	SELECT
		o.id AS order_id,
		o.client_id AS client_id,
		o.payment_method AS payment_method,
		o.created_at AS created_at,
		(
			SELECT l.currency FROM order_line l
			WHERE l.order_id = o.id AND l.deleted_at IS NULL
			ORDER BY l.id LIMIT 1
		) AS currency,
		(
			SELECT l.exchange_rate FROM order_line l
			WHERE l.order_id = o.id AND l.deleted_at IS NULL
			ORDER BY l.id LIMIT 1
		) AS exchange_rate,
		COALESCE((
			SELECT SUM(
				ROUND(l.price * l.quantity - l.discount_reduction, 2)
				+ ROUND((l.price * l.quantity - l.discount_reduction) * l.vat_rate / 100, 2)
			)
			FROM order_line l
			WHERE l.order_id = o.id AND l.deleted_at IS NULL
		), 0)
		+ COALESCE((
			SELECT SUM(
				ROUND(s.price - s.discount_reduction, 2)
				+ ROUND((s.price - s.discount_reduction) * s.vat_rate / 100, 2)
			)
			FROM shipping s
			WHERE s.order_id = o.id AND s.deleted_at IS NULL AND s.status <> 'failed'
		), 0) AS total_gross
	FROM "order" o
	WHERE o.status = 'pending' AND o.deleted_at IS NULL
	ORDER BY o.id
`;

/**
 * How the shopper said they would pay, as the ledger records it. Mirrors the map
 * `CartService` applies at checkout; an order raised in the back office states nothing, and
 * those are seeded as a bank transfer.
 */
const METHOD_BY_PAYMENT_METHOD: Record<string, CashFlowMethod> = {
	cash_on_delivery: CashFlowMethodEnum.CASH,
	card: CashFlowMethodEnum.CREDIT_CARD,
	bank_transfer: CashFlowMethodEnum.BANK_TRANSFER,
};

/**
 * The reference a seeded payment request carries, one per order and stable across re-runs.
 *
 * Padded here rather than through `sequenceLabel`, which adds one to turn a zero-based loop index
 * into a human-readable ordinal. This is an id, and shifting it would leave every reference naming
 * the order next to the one it settles.
 */
const orderPaymentReference = (orderId: number): string => {
	return `SEED-CFO-${String(orderId).padStart(5, '0')}`;
};

/**
 * The payment request a checkout raises beside its order: `pending`, for what the buyer owes
 * gross, recorded against both the client and the order.
 *
 * This is the shape the shop's happy path starts from - capturing one of these confirms its order
 * and raises the charge (see `order-settlement.registry.ts`). Every one is left `pending` on
 * purpose: a captured movement against an order still `pending` is a state the chain never produces, and
 * seeding one would misrepresent the flow for anyone reading the demo data.
 *
 * `vat_rate` is 0, as in production - a movement carries one rate while an order mixes them
 * across its lines and its delivery, and the breakdown belongs to the invoice.
 */
async function seedOrderPayments(
	manager: EntityManager,
): Promise<{ inserted: number; alreadyPresent: number; target: number }> {
	const orders: PayableOrderRow[] = await manager.query(PAYABLE_ORDERS_QUERY);

	const payable = orders.filter((order) => Number(order.total_gross) > 0);

	const existing = new Set(
		(
			await manager
				.getRepository(CashFlowEntity)
				.createQueryBuilder('cash_flow')
				.select(['cash_flow.external_reference'])
				.where('cash_flow.external_reference IN (:...references)', {
					references: payable.map((order) =>
						orderPaymentReference(order.order_id),
					),
				})
				.withDeleted()
				.getMany()
		).map((entry) => entry.external_reference),
	);

	const pending = payable.filter(
		(order) => !existing.has(orderPaymentReference(order.order_id)),
	);

	for (const order of pending) {
		const currency = order.currency?.trim() || resolveBaseCurrency();

		const entry = await manager.getRepository(CashFlowEntity).save({
			direction: CashFlowDirectionEnum.IN,
			category_type: CashFlowCategoryTypeEnum.REVENUE,
			category: CashFlowCategoryEnum.SALE,
			method: order.payment_method
				? (METHOD_BY_PAYMENT_METHOD[order.payment_method] ??
					CashFlowMethodEnum.BANK_TRANSFER)
				: CashFlowMethodEnum.BANK_TRANSFER,
			status: CashFlowStatusEnum.PENDING,
			amount: Math.round(
				Number(order.total_gross) * 10 ** AMOUNT_DECIMALS,
			),
			vat_rate: 0,
			currency: currency,
			exchange_rate: Number(order.exchange_rate ?? 1),
			external_reference: orderPaymentReference(order.order_id),
			parent_id: null,
			notes: null,
			// The money is asked for the moment the order is placed
			created_at: order.created_at,
		});

		await manager.getRepository(OperationalRecordEntity).save([
			{
				cash_flow_id: entry.id,
				operational_record_type: OperationalRecordTypeEnum.CLIENT,
				entity_id: order.client_id,
				notes: null,
			},
			{
				cash_flow_id: entry.id,
				operational_record_type: OperationalRecordTypeEnum.ORDER,
				entity_id: order.order_id,
				notes: null,
			},
		]);
	}

	return {
		inserted: pending.length,
		alreadyPresent: payable.length - pending.length,
		target: payable.length,
	};
}

/**
 * An order the shop has already accepted, with the buyer behind it.
 *
 * Plain SQL for the same reason `PAYABLE_ORDERS_QUERY` is: this feature does not import `order`,
 * and a seed reaching across would be the one place that claim stops being true.
 *
 * Only `confirmed` and `completed`, because only those are states a captured payment produces -
 * see `seedSaleCounterparties`.
 */
type AcceptedOrderRow = {
	order_id: number;
	client_id: number;
};

const ACCEPTED_ORDERS_QUERY = `
	SELECT o.id AS order_id, o.client_id AS client_id
	FROM "order" o
	WHERE o.status IN ('confirmed', 'completed') AND o.deleted_at IS NULL
	ORDER BY o.id
`;

/**
 * Buyers an invoice can actually be addressed to.
 *
 * Filtered on holding a billing address, because that is what `InvoiceService` freezes onto a
 * document raised from a bare movement - a sale filed under a client with no address on file is a
 * row the "generate invoice" action can only refuse. Clients without one still appear all over the
 * demo data; they are simply not the ones money gets filed under here.
 */
const BILLABLE_CLIENTS_QUERY = `
	SELECT DISTINCT c.id
	FROM client c
	JOIN client_address ca ON ca.client_id = c.id AND ca.type = 'billing'
	WHERE c.deleted_at IS NULL
	ORDER BY c.id
`;

/** One in every three captured sales is matched to an order; the rest name only the buyer. */
const ORDER_SHARE = 3;

/**
 * Files the general pass's sales under the counterparty they belong to.
 *
 * The rows come out of `topUp`, which returns a summary rather than what it inserted, so this is a
 * pass of its own keyed on the absence of any record - which makes it idempotent and lets it also
 * repair rows seeded before this existed.
 *
 * **Every sale names a client**, because `getOperationalRecordOptions` makes it required for the
 * category and `CashFlowService.checkOperationalRecords` refuses a create without one. A seed
 * inserting through the repository never meets that check, so rows that break the feature's own
 * rule are exactly what it used to leave behind - and a movement with no client is one nothing can
 * raise a document for.
 *
 * **Only a captured sale is matched to an order**, and only to one the shop has accepted. That is
 * the pairing the chain actually produces: the money lands, which confirms the order (see
 * `order-settlement.registry.ts`). A completed movement against a `pending` order, or a pending
 * movement against a `confirmed` one, are states nothing in the app reaches, and seeding them would
 * misrepresent the flow for anyone reading the demo data - the same reason `seedOrderPayments`
 * leaves every one of its rows `pending`.
 *
 * The client is taken from the order in that case rather than drawn separately, so the two records
 * on a row never name a buyer and somebody else's document.
 */
async function seedSaleCounterparties(manager: EntityManager): Promise<number> {
	const clientIds: number[] = (
		await manager.query(BILLABLE_CLIENTS_QUERY)
	).map((row: { id: number }) => row.id);

	if (clientIds.length === 0) {
		return 0;
	}

	/*
	 * A sale is picked up when it names no buyer at all, and also when the buyer it names cannot
	 * be billed - an address added, removed or never present moves a client between the two, and
	 * `client_record_id` is what lets the second case re-point the row it already has instead of
	 * inserting a duplicate the unique index would refuse.
	 */
	const unfiled: {
		id: number;
		status: string;
		client_record_id: number | null;
		linked_order_client_id: number | null;
	}[] = await manager.query(`
		SELECT cf.id, cf.status, cl.id AS client_record_id, o.client_id AS linked_order_client_id
		FROM cash_flow cf
		LEFT JOIN operational_record cl
			ON cl.cash_flow_id = cf.id
			AND cl.operational_record_type = '${OperationalRecordTypeEnum.CLIENT}'
			AND cl.deleted_at IS NULL
		LEFT JOIN operational_record od
			ON od.cash_flow_id = cf.id
			AND od.operational_record_type = '${OperationalRecordTypeEnum.ORDER}'
			AND od.deleted_at IS NULL
		LEFT JOIN "order" o ON o.id = od.entity_id
		WHERE cf.category = '${CashFlowCategoryEnum.SALE}'
		  AND cf.external_reference LIKE 'SEED-CF-%'
		  AND (
			cl.id IS NULL
			OR NOT EXISTS (
				SELECT 1 FROM client_address ca
				WHERE ca.client_id = cl.entity_id AND ca.type = 'billing'
			)
		  )
		ORDER BY cf.id
	`);

	if (unfiled.length === 0) {
		return 0;
	}

	const orders: AcceptedOrderRow[] = await manager.query(
		ACCEPTED_ORDERS_QUERY,
	);

	const records: Partial<OperationalRecordEntity>[] = [];

	let orderCursor = 0;

	unfiled.forEach((entry, index) => {
		// A row that already names an order keeps it - the document is not this pass's to restate,
		// and attaching a second would break the unique index over (cash_flow_id, type)
		const hasOrder = entry.linked_order_client_id !== null;

		const order =
			!hasOrder &&
			orders.length > 0 &&
			entry.status === CashFlowStatusEnum.COMPLETED &&
			index % ORDER_SHARE === 0
				? orders[orderCursor++ % orders.length]
				: undefined;

		/*
		 * Whichever order the row ends up naming, its buyer is the one filed - so the two records
		 * can never name a buyer and somebody else's document. Only a row with no order at all
		 * draws from the billable pool.
		 *
		 * Keyed on the row's own id rather than on the shared PRNG: this pass runs after the
		 * general one has consumed it, so an id keeps a re-run assigning the same buyer.
		 */
		const clientId =
			entry.linked_order_client_id ??
			order?.client_id ??
			clientIds[entry.id % clientIds.length];

		records.push({
			// Present when the row already names a buyer who cannot be billed, which makes this
			// an update of that record rather than a second one
			...(entry.client_record_id ? { id: entry.client_record_id } : {}),
			cash_flow_id: entry.id,
			operational_record_type: OperationalRecordTypeEnum.CLIENT,
			entity_id: clientId,
			notes: null,
		});

		if (order) {
			records.push({
				cash_flow_id: entry.id,
				operational_record_type: OperationalRecordTypeEnum.ORDER,
				entity_id: order.order_id,
				notes: null,
			});
		}
	});

	await manager
		.getRepository(OperationalRecordEntity)
		.save(records, { chunk: 50 });

	return unfiled.length;
}

export const cashFlowSeed: SeedDefinition = {
	name: 'cash-flow',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const baseCurrency = resolveBaseCurrency();

		const general = await topUp({
			entity: 'cash-flow',
			target: TARGET,
			manager,
			entityClass: CashFlowEntity,
			// Nullable and indexed, and every seeded row fills it - so it identifies the
			// demo rows without touching anything already in the table.
			keyColumn: 'external_reference',
			buildRow: (index) => {
				const category = randomPick(random, CATEGORY_POOL);
				const categoryType = getExpectedCategoryType(category);
				const direction = getExpectedDirection(categoryType);

				if (!direction) {
					throw new Error(
						`Category "${category}" has no fixed direction and needs a parent entry`,
					);
				}

				const range = AMOUNT_RANGES[category];

				if (!range) {
					throw new Error(
						`Category "${category}" has no amount range`,
					);
				}

				const [minAmount, maxAmount] = range;

				const currency = randomPick(random, [
					baseCurrency,
					baseCurrency,
					baseCurrency,
					'EUR',
				]);

				return {
					direction,
					category_type: categoryType,
					category,
					method: randomPick(random, [
						CashFlowMethodEnum.CREDIT_CARD,
						CashFlowMethodEnum.CREDIT_CARD,
						CashFlowMethodEnum.DEBIT_CARD,
						CashFlowMethodEnum.PAYPAL,
						CashFlowMethodEnum.BANK_TRANSFER,
						CashFlowMethodEnum.CASH,
					]),
					status: randomPick(random, [
						CashFlowStatusEnum.COMPLETED,
						CashFlowStatusEnum.COMPLETED,
						CashFlowStatusEnum.COMPLETED,
						CashFlowStatusEnum.PENDING,
						CashFlowStatusEnum.AUTHORIZED,
						CashFlowStatusEnum.CANCELED,
					]),
					// Stored separator-less, scaled by 10 ** AMOUNT_DECIMALS, and the CHECK
					// constraint requires it to be strictly positive.
					amount:
						randomInt(random, minAmount, maxAmount) *
						10 ** AMOUNT_DECIMALS,
					vat_rate: randomPick(random, VAT_RATES),
					currency,
					exchange_rate:
						currency === baseCurrency
							? 1
							: (EXCHANGE_RATES[currency] ?? 1),
					external_reference: `SEED-CF-${sequenceLabel(index, 5)}`,
					parent_id: null,
					notes: null,
					// `@CreateDateColumn` only falls back to the column default when the value
					// is undefined, so an explicit date is kept as-is.
					created_at: createdAtForIndex(random, index),
				};
			},
		});

		const payments = await seedOrderPayments(manager);

		// After the general pass, which is what leaves the sales it inserts unfiled
		await seedSaleCounterparties(manager);

		// One line for the two passes. `tableTotal` comes from the general pass, which counted
		// every row in the table - the payment requests it did not know about yet included
		return {
			entity: 'cash-flow',
			alreadyPresent: general.alreadyPresent + payments.alreadyPresent,
			inserted: general.inserted + payments.inserted,
			target: general.target + payments.target,
			tableTotal: general.tableTotal + payments.inserted,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(cashFlowSeed);
}
