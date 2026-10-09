import { type EntityManager, In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError } from '@/exceptions';
import {
	type ClientService,
	clientService,
} from '@/features/client/client.service';
import {
	type ClientAddressService,
	clientAddressService,
} from '@/features/client-address/client-address.service';
import {
	DiscountScopeEnum,
	type DiscountSnapshot,
} from '@/features/discount/discount.entity';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import { documentSeriesService } from '@/features/document-series/document-series.service';
import { exchangeRateService } from '@/features/exchange-rate/exchange-rate.service';
import OrderEntity, {
	type ManualDiscount,
	type OrderBillingAddress,
	type OrderPaymentMethod,
	OrderPaymentMethodEnum,
	type OrderStatus,
	OrderStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/order/order.entity';
import {
	type AfterCommit,
	cancelOrderPayment,
	findOrdersAwaitingPayment,
	isOrderClientLocked,
	isOrderInvoiced,
	notifyOrderCanceled,
	notifyOrderConfirmed,
	notifyOrderFulfillmentReleased,
	syncOrderDelivery,
	syncOrderPayment,
} from '@/features/order/order.hooks';
import {
	getOrderLineRepository,
	getOrderRepository,
} from '@/features/order/order.repository';
import {
	type OrderValidator,
	paramsUpdateList,
} from '@/features/order/order.validator';
import {
	type OrderBundleService,
	orderBundleService,
} from '@/features/order/order-bundle.service';
import {
	type OrderDiscountContext,
	type OrderDiscountLine,
	type OrderDiscountService,
	orderDiscountService,
} from '@/features/order/order-discount.service';
import OrderLineEntity from '@/features/order/order-line.entity';
import {
	type OrderOptionService,
	orderOptionService,
} from '@/features/order/order-option.service';
import ProductContentEntity from '@/features/product/product-content.entity';
import type { ProductOptionSnapshot } from '@/features/product/product-option.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { roundMoney } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * One line as the caller hands it over: already priced, already decided.
 *
 * **The order does not price anything.** Whoever asks for one has already resolved what the goods
 * cost - a cart against the live catalog, a subscription against the terms it renews under, an
 * operator agreeing a figure on the phone - and this is where those figures stop moving. Deciding
 * them here would mean re-deriving a number the customer has already been shown, and quietly
 * disagreeing with it.
 *
 * The discount is the one figure the back-office path does resolve for itself, in `createEntry` and
 * `buildLines` rather than here: a caller composing a document by hand states a price, not which
 * promotions are running. A cart arrives with its own already costed and passes them straight
 * through.
 *
 * Deliberately not `CartLine`: an order is not a cart's output, it is a document several things
 * may raise. Naming the cart's type here would make `order` depend on `cart`, which is backwards -
 * and would leave the second caller converting into a shape it has no reason to know about.
 */
export type OrderLineInput = {
	variant_id: number;
	product_id: number;
	quantity: number;
	/** Unit price excluding VAT, in `currency`, with any option deltas already folded in. */
	price: number;
	vat_rate: number;
	/**
	 * The rules that reduced this line, each carrying the share it took. An array because a line
	 * discount and an order-wide campaign stack, and the document has to name both.
	 */
	discount?: DiscountSnapshot[] | null;
	/** Money off the whole line, in `currency` - the snapshots above, summed. */
	discount_reduction?: number;
	options?: ProductOptionSnapshot[] | null;
	notes?: string | null;
	/** On a bundle component, the `product_bundle_item` it was taken from. */
	bundle_item_id?: number | null;
	/**
	 * The components a bundle explodes into, per `product.md` §8.3.
	 *
	 * Present only on a bundle header, which carries `price: 0` while these carry all of its
	 * money - each an apportioned share of the bundle price at its **own** `vat_rate`, which is
	 * the whole reason the explosion exists: one rate per line cannot state food at 11% beside a
	 * drink at 21%.
	 *
	 * The caller apportions. `OrderService` records, as it does for every other figure on a line -
	 * the same split the shopper was quoted is the one that reaches the document.
	 *
	 * A child carries no children of its own: `product.md` §8.4 forbids nested bundles.
	 */
	children?: readonly Omit<OrderLineInput, 'children'>[];
};

export type OrderCreateInput = {
	client_id: number;
	currency: string;
	/**
	 * Rate to the base currency, following `order_line.exchange_rate`.
	 *
	 * Optional: a caller holding no rate - a checkout, which quotes a basket in the shopper's own
	 * currency and resolves none - leaves it out, and the document resolves the current one.
	 * Stated only by a caller that already froze the money at a known rate.
	 */
	exchange_rate?: number;
	lines: readonly OrderLineInput[];
	/** How the client pays. Absent on a back-office document that has not agreed it yet. */
	payment_method?: OrderPaymentMethod | null;
	/**
	 * The client address the order is billed to. Absent on a back-office document that has not
	 * agreed one yet.
	 *
	 * The caller is what proves the address belongs to the billed client - a checkout resolves it
	 * through `ClientAddressService.getOrderSnapshot`, which answers a 404 for anybody else's.
	 */
	billing_address?: OrderBillingAddress | null;
	notes?: string | null;
	/**
	 * The snapshot of an order-wide discount an operator typed, as `OrderDiscountService` costed
	 * it. The lines arrive with their shares of it already apportioned.
	 */
	discount?: DiscountSnapshot | null;
};

/**
 * What the document adds up to, in its own currency.
 *
 * **Net of the discounts.** Each line carries what its discount took off (`discount_reduction`),
 * resolved when the document was raised and clamped there against `product_price.min_price` - so
 * the reduction is read rather than replayed from a snapshot that never carried the floor. VAT
 * follows the money: it is charged on what is left after the reduction, which is also how the cart
 * quotes a basket.
 *
 * `subtotal` stays the quoted figure, before anything came off, so a reader can see both halves of
 * the arithmetic instead of a total that silently disagrees with the line prices above it.
 */
export type OrderTotals = {
	currency: string;
	exchange_rate: number;
	/** Sum of `price x quantity` over every line, VAT excluded and before any discount. */
	subtotal: number;
	/** Sum of the line reductions, VAT excluded - the order-wide campaign included. */
	discount_reduction: number;
	/**
	 * How much of `discount_reduction` came from an order-wide campaign rather than from the
	 * lines' own discounts.
	 *
	 * Derived from the snapshots rather than stored: the money itself lives in the line
	 * reductions, where the VAT base needs it, and a second column holding the same figure is one
	 * that can drift from them.
	 */
	order_discount_reduction: number;
	/** VAT on the subtotal net of those reductions, each line at its own rate. */
	vat_amount: number;
	total: number;
	has_discount: boolean;
};

/** The billing address as the back-office payload states it - without the country's name. */
type BillingAddressPayload = NonNullable<
	ValidatorOutput<OrderValidator, 'create'>['billing_address']
>;

/** One line as the back-office payload states it, after validation. */
type OrderLinePayload = ValidatorOutput<
	OrderValidator,
	'create'
>['lines'][number];

/**
 * The document as `read` hands it over: the order row itself, with its lines and their sum
 * attached. Flat rather than `{ order, lines, totals }` so the shape a detail view is given is
 * still an order - the same thing the listing returns, with more on it - which is what `cart`
 * does with its `pricing`.
 */
export type OrderWithLines = OrderEntity & {
	lines: OrderLineWithLabel[];
	totals: OrderTotals;
};

/**
 * A line with its product's name attached, so a document can say what was sold - a bundle's
 * component names another product than its header, and a SKU tells a reader nothing.
 *
 * Resolved in the default content language rather than the request's: the `read` payload is
 * cached per order id alone, so a per-request language would serve whichever one warmed the key.
 * `null` when the product has no translation in that language.
 */
export type OrderLineWithLabel = OrderLineEntity & {
	label: string | null;
};

/**
 * A line set's typed discounts as one comparable string: the order-wide one, then each line's by
 * variant, sorted so the order the lines arrive in does not count as a change.
 */
function describeManualDiscounts(set: {
	discount?: ManualDiscount | null;
	lines: readonly { variant_id: number; discount?: ManualDiscount | null }[];
}): string {
	const describe = (discount: ManualDiscount | null | undefined) =>
		discount ? `${discount.type}:${Number(discount.value)}` : '-';

	return JSON.stringify({
		order: describe(set.discount),
		lines: set.lines
			.filter((line) => line.discount)
			.map((line) => `${line.variant_id}=${describe(line.discount)}`)
			.sort(),
	});
}

/**
 * The terms a stored order-wide snapshot was costed from - to re-apportion it over a new line set,
 * or to tell whether a payload changes it. Null for anything an operator did not type.
 */
function toManualTerms(
	snapshot: DiscountSnapshot | null | undefined,
): ManualDiscount | null {
	return snapshot?.manual
		? { type: snapshot.type, value: Number(snapshot.value) }
		: null;
}

const ENTRY_COLUMNS = [
	'order.id',
	'order.client_id',
	'order.ref_code',
	'order.ref_number',
	'order.status',
	'order.payment_method',
	'order.billing_address',
	'order.notes',
	'order.discount',
	'order.created_at',
	'order.updated_at',
	'order.deleted_at',
];

/**
 * `person_identification_number` is `select: false` on the entity and stays off every order read -
 * a document listing needs to name the counterparty, not identify them for the authorities.
 */
const CLIENT_COLUMNS = [
	'client.id',
	'client.client_type',
	'client.status',
	'client.company_name',
	'client.person_name',
	'client.contact_email',
];

/**
 * What the buyer's own order page states about who it was billed to, beyond the listing's name:
 * the company's registration and the contact phone. The personal identification number stays
 * off - a buyer has no need to be shown it back, and it is the one column here worth not
 * repeating on a page.
 */
const PUBLIC_DETAIL_CLIENT_COLUMNS = [
	...CLIENT_COLUMNS,
	'client.company_cui',
	'client.company_reg_com',
	'client.contact_phone',
];

/**
 * The document as its buyer sees it. `deleted_at` is dropped because a soft-deleted order is never
 * served to them; `client_id` stays so a buyer holding several clients can tell which one was billed.
 */
const PUBLIC_ENTRY_COLUMNS = ENTRY_COLUMNS.filter(
	(column) => column !== 'order.deleted_at',
);

const LINE_COLUMNS = [
	'order_line.id',
	'order_line.order_id',
	'order_line.parent_id',
	'order_line.bundle_item_id',
	'order_line.variant_id',
	'order_line.product_id',
	'order_line.quantity',
	'order_line.price',
	'order_line.vat_rate',
	'order_line.currency',
	'order_line.exchange_rate',
	'order_line.discount',
	'order_line.discount_reduction',
	'order_line.options',
	'order_line.notes',
];

const LINE_VARIANT_COLUMNS = ['variant.id', 'variant.sku'];

export class OrderService {
	constructor(
		private repository: ReturnType<typeof getOrderRepository>,
		private lineRepository: ReturnType<typeof getOrderLineRepository>,
		private clientService: ClientService,
		private clientAddressService: ClientAddressService,
		private discountService: OrderDiscountService,
		private optionService: OrderOptionService,
		private bundleService: OrderBundleService,
	) {}

	/**
	 * The client is `ON DELETE RESTRICT`, so a bad id would surface as a masked 500 from the
	 * foreign key. Resolving it first turns that into the client feature's own 404.
	 *
	 * `withDeleted` is false: a document must not be raised against a counterparty somebody
	 * removed.
	 */
	private async checkClientId(clientId: number): Promise<void> {
		await this.clientService.findById(clientId, false);
	}

	/**
	 * The billing address as the order stores it, from what an operator typed. The country's name
	 * is looked up from its code rather than accepted, so the name an invoice prints and the code a
	 * discount condition matches can never disagree; a code no country carries answers 400.
	 */
	private async toBillingAddress(
		input: BillingAddressPayload | null | undefined,
	): Promise<OrderBillingAddress | null> {
		if (!input) {
			return null;
		}

		const country = input.country_code
			? await this.clientAddressService.resolveCountry(input.country_code)
			: null;

		if (input.country_code && !country) {
			throw new BadRequestError(
				lang('order.error.billing_country_unknown', {
					code: input.country_code,
				}),
			);
		}

		return {
			details: input.details,
			postal_code: input.postal_code,
			address_city: input.address_city,
			address_region: input.address_region,
			address_country: country?.name ?? null,
			country_code: country?.code ?? null,
			notes: input.notes,
		};
	}

	/**
	 * Refuses a caller without the `discount` permission who sets, changes or clears a typed
	 * discount. Compared against what the document already carries rather than refused on sight:
	 * the dashboard sends every line back on an edit, its typed discounts included, and an operator
	 * correcting a quantity on a discounted order has not handed out a discount by doing so.
	 *
	 * Lines are matched by variant rather than position - a line set is replaced wholesale, so
	 * position is not an identity, and reordering it changes nothing anybody agreed. The order-wide
	 * one is compared against `order.discount`; `entry` is absent on a create, which carries none.
	 */
	private async assertMayDiscount(
		canDiscount: boolean,
		incoming: {
			discount?: ManualDiscount | null;
			lines: readonly {
				variant_id: number;
				discount?: ManualDiscount | null;
			}[];
		},
		entry?: OrderEntity,
	): Promise<void> {
		if (canDiscount) {
			return;
		}

		const stored = entry
			? {
					discount: toManualTerms(entry.discount),
					lines: await this.readManualLineDiscounts(entry.id),
				}
			: { discount: null, lines: [] };

		if (
			describeManualDiscounts(incoming) !==
			describeManualDiscounts(stored)
		) {
			throw new CustomError(
				403,
				lang('order.error.discount_not_allowed'),
			);
		}
	}

	/**
	 * The discount typed on each stored line, read back off its snapshots - the only place a
	 * line's own lives (see `DiscountSnapshot.manual`).
	 */
	private async readManualLineDiscounts(
		orderId: number,
	): Promise<{ variant_id: number; discount: ManualDiscount | null }[]> {
		const rows = await dataSource.getRepository(OrderLineEntity).find({
			select: { id: true, variant_id: true, discount: true },
			where: { order_id: orderId },
		});

		return rows.map((row) => {
			const found = row.discount?.find(
				(snapshot) =>
					snapshot.manual &&
					snapshot.scope === DiscountScopeEnum.VARIANT,
			);

			return {
				variant_id: row.variant_id,
				discount: found
					? { type: found.type, value: Number(found.value) }
					: null,
			};
		});
	}

	/**
	 * The rate the document's money is frozen at, read from `exchange_rate` rather than accepted
	 * from the caller. A back-office operator agrees prices, not the rate the accounts convert
	 * them at, and a figure typed into the payload is one nobody can reconcile against the
	 * published series later.
	 *
	 * `asOf` defaults to now, which is the creation date for a new order. A line edit passes the
	 * order's `created_at`, so a document amended days later still converts at what the day it
	 * was raised was worth. `getRateAsOf` carries the previous publication forward across a
	 * weekend or a holiday.
	 *
	 * An unpublished currency is refused rather than defaulted to 1, following `cash-flow`: this
	 * is a financial document, and converting at a made-up rate is worse than declining to write
	 * it. The deployment's own currency answers 1 without a query.
	 *
	 * Public for a caller writing a sibling row at the same rate in the same transaction - a
	 * checkout's shipment is priced in the order's currency and has to be frozen alongside it.
	 */
	public async resolveExchangeRate(
		currency: string,
		asOf?: Date,
	): Promise<number> {
		const rate = await exchangeRateService.getRateAsOf(currency, asOf);

		if (rate === null) {
			throw new BadRequestError(
				lang('order.error.exchange_rate_unavailable', {
					currency: currency,
				}),
			);
		}

		return rate;
	}

	/**
	 * Proves every line names a variant that exists and belongs to the product beside it.
	 *
	 * The composite foreign key over `(variant_id, product_id)` already refuses a mismatched pair,
	 * but it refuses it as a constraint violation - a masked 500 that tells the operator nothing.
	 * One query for the whole document answers the same question as a 422 naming the line.
	 *
	 * Deleted variants are excluded: a withdrawn product may still be invoiced on an order raised
	 * before it went, but it is not something new can be sold from.
	 */
	private async checkLines(
		lines: readonly { variant_id: number; product_id: number }[],
	): Promise<void> {
		const variantIds = [...new Set(lines.map((line) => line.variant_id))];

		const variants = await dataSource
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true, product_id: true },
				where: { id: In(variantIds) },
			});

		const productByVariant = new Map(
			variants.map((variant) => [variant.id, variant.product_id]),
		);

		for (const line of lines) {
			const productId = productByVariant.get(line.variant_id);

			if (productId === undefined || productId !== line.product_id) {
				throw new BadRequestError(
					lang('order.error.invalid_line', {
						variant_id: String(line.variant_id),
					}),
				);
			}
		}
	}

	/**
	 * Raises an order and its lines.
	 *
	 * **Takes the caller's `EntityManager` rather than opening its own transaction.** The series
	 * number is allocated inside it, so an order that fails to write rolls the counter back with
	 * itself and the `ORD` series stays gapless - and whatever the caller does in the same
	 * transaction (a cart flipping to `converted`, a subscription recording its renewal) commits
	 * or fails together with the document it produced. An inner transaction would commit the order
	 * before the caller's own write had a chance to fail.
	 *
	 * Always enters at `pending`, whichever caller raises it - a checkout or the back office. Every
	 * later state is reached through `updateStatus`, which is what checks the move is allowed.
	 */
	public async create(
		manager: EntityManager,
		data: OrderCreateInput,
	): Promise<OrderEntity> {
		if (data.lines.length === 0) {
			throw new BadRequestError(lang('order.error.no_lines'));
		}

		/*
		 * The rate belongs to the document rather than to whoever raised it. A checkout hands over
		 * figures in the shopper's currency and no rate at all, so this is the moment the money is
		 * frozen - and an unpublished currency is refused here rather than converted at a made-up
		 * rate, the same bar the back-office path holds.
		 */
		const exchangeRate =
			data.exchange_rate ??
			(await this.resolveExchangeRate(data.currency));

		const reference = await documentSeriesService.allocate(
			manager,
			DocumentTypeEnum.ORDER,
		);

		const order = await manager.save(
			manager.create(OrderEntity, {
				client_id: data.client_id,
				ref_code: reference.code,
				ref_number: reference.number,
				status: OrderStatusEnum.PENDING,
				payment_method: data.payment_method ?? null,
				billing_address: data.billing_address ?? null,
				notes: data.notes ?? null,
				discount: data.discount ?? null,
			}),
		);

		await this.writeLines(
			manager,
			order.id,
			data.lines,
			data.currency,
			exchangeRate,
		);

		return order;
	}

	/**
	 * Writes the line set of a document that already exists.
	 *
	 * One `save` for the whole set rather than a save per line: they are written together or not
	 * at all, and a basket of twenty is twenty round trips otherwise.
	 *
	 * **Two passes when any line carries components.** A child's `parent_id` is its header's
	 * generated id, which does not exist until the headers are saved, so the set cannot go in one
	 * statement. Both passes run on the caller's manager, inside the caller's transaction, so a
	 * failure between them leaves no header stranded without its components.
	 */
	private async writeLines(
		manager: EntityManager,
		orderId: number,
		lines: readonly OrderLineInput[],
		currency: string,
		exchangeRate: number,
	): Promise<void> {
		const build = (
			line: Omit<OrderLineInput, 'children'>,
			parentId: number | null,
		) =>
			manager.create(OrderLineEntity, <Partial<OrderLineEntity>>{
				order_id: orderId,
				parent_id: parentId,
				variant_id: line.variant_id,
				product_id: line.product_id,
				quantity: line.quantity,
				vat_rate: line.vat_rate,
				/*
				 * The unit price the line was quoted at, with the discount recorded beside it
				 * as a snapshot rather than folded into the figure - so an invoice can show
				 * what was taken off and why, and the arithmetic stays checkable years later
				 * against a promotion that has since been withdrawn.
				 */
				price: line.price,
				currency: currency,
				exchange_rate: exchangeRate,
				discount:
					line.discount && line.discount.length > 0
						? line.discount
						: null,
				discount_reduction: line.discount_reduction ?? 0,
				options:
					line.options && line.options.length > 0
						? line.options
						: null,
				notes: line.notes ?? null,
				bundle_item_id: line.bundle_item_id ?? null,
			});

		const headers = await manager.save(
			lines.map((line) => build(line, null)),
		);

		/*
		 * Zipped by position rather than matched by variant: a document may legitimately carry the
		 * same bundle twice, configured differently, and the two headers are told apart by nothing
		 * else. `save` returns the rows in the order it was given them, which is what makes the
		 * index line up with `lines`.
		 */
		const children = lines.flatMap((line, index) =>
			(line.children ?? []).map((child) =>
				build(child, headers[index].id),
			),
		);

		if (children.length > 0) {
			await manager.save(children);
		}
	}

	/**
	 * @description Used in `create` method from controller; composes a back-office document
	 *
	 * Opens its own transaction, unlike `create` above: nothing else is being written alongside
	 * it, and the series allocation still has to roll back with a document that fails to save.
	 *
	 * It enters at `pending`, like a checkout's order, and **spends a series number on the way
	 * in** - a pending order canceled before confirmation leaves its number spent. Reserving
	 * instead of allocating needs a reservation row the series feature does not have yet (TODO
	 * item 8).
	 */
	public async createEntry(
		data: ValidatorOutput<OrderValidator, 'create'>,
		canDiscount: boolean,
	): Promise<OrderEntity> {
		await this.checkClientId(data.client_id);
		await this.checkLines(data.lines);
		await this.assertMayDiscount(canDiscount, data);

		const billingAddress = await this.toBillingAddress(
			data.billing_address,
		);
		const exchangeRate = await this.resolveExchangeRate(data.currency);

		/*
		 * The buyer's country, for a campaign that names one. A back-office document may not have
		 * agreed a billing address yet, and every country condition then fails closed - which is
		 * the same answer the storefront gives a basket that has chosen none.
		 */
		const countryCode = billingAddress?.country_code ?? null;

		const composed = await this.composeLines(
			data.lines,
			{
				clientId: data.client_id,
				countryCode: countryCode,
				currency: data.currency,
				exchangeRate: exchangeRate,
				now: new Date(),
			},
			data.discount,
		);

		return dataSource.transaction((manager) =>
			this.create(manager, {
				client_id: data.client_id,
				currency: data.currency,
				exchange_rate: exchangeRate,
				billing_address: billingAddress,
				notes: data.notes ?? null,
				discount: composed.discount,
				lines: composed.rows,
			}),
		);
	}

	/**
	 * Turns a back-office line set into rows ready to write - the one place both `createEntry` and
	 * `buildLines` go through, so a created and an edited document cannot be composed differently.
	 *
	 * - **Options** are resolved into snapshots against the catalog (`OrderOptionService`).
	 * - **A bundle line becomes a header and its components** (`OrderBundleService`): the header
	 *   at `price` and `vat_rate` 0, the operator's bundle price divided over the components at
	 *   their own rates (`rules/product.md` §8.3). The header keeps the line's options and note.
	 * - **Discounts are resolved over what carries money** - ordinary lines and bundle components,
	 *   never a header, which is what the cart does too (`rules/discount.md` §4). A typed discount
	 *   on a bundle line is refused: it would have to be divided over components priced at
	 *   different rates, and the order-wide discount already does exactly that.
	 */
	private async composeLines(
		lines: readonly OrderLinePayload[],
		context: OrderDiscountContext,
		orderDiscount?: ManualDiscount | null,
	): Promise<{ rows: OrderLineInput[]; discount: DiscountSnapshot | null }> {
		const [options, bundles] = await Promise.all([
			this.optionService.resolveForLines(lines, context.currency),
			this.bundleService.explodeForLines(lines, context.currency),
		]);

		lines.forEach((line, index) => {
			if (bundles[index] && line.discount) {
				throw new BadRequestError(
					lang('order.error.bundle_discount', {
						variant_id: String(line.variant_id),
					}),
				);
			}
		});

		// Flattened in line order, a bundle contributing its components in its own place
		const priced = lines.flatMap(
			(line, index): OrderDiscountLine[] => bundles[index] ?? [line],
		);

		const discounts = await this.discountService.resolveForLines(
			priced,
			context,
			orderDiscount,
		);

		let cursor = 0;

		const rows = lines.map((line, index): OrderLineInput => {
			const components = bundles[index];

			if (!components) {
				const resolved = discounts.lines[cursor++];

				return {
					variant_id: line.variant_id,
					product_id: line.product_id,
					quantity: line.quantity,
					price: line.price,
					vat_rate: line.vat_rate,
					discount: resolved?.snapshots ?? null,
					discount_reduction: resolved?.reduction ?? 0,
					options: options[index],
					notes: line.notes ?? null,
				};
			}

			return {
				variant_id: line.variant_id,
				product_id: line.product_id,
				quantity: line.quantity,
				price: 0,
				vat_rate: 0,
				discount: null,
				discount_reduction: 0,
				options: options[index],
				notes: line.notes ?? null,
				children: components.map((component) => {
					const resolved = discounts.lines[cursor++];

					return {
						...component,
						discount: resolved?.snapshots ?? null,
						discount_reduction: resolved?.reduction ?? 0,
					};
				}),
			};
		});

		return {
			rows: rows,
			discount: discounts.campaign?.manual ? discounts.campaign : null,
		};
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 *
	 * The lines are replaced as a set and **only while the order is `pending`** - checkout orders
	 * included, so an operator can correct what was placed before accepting it. Once confirmed the
	 * business has accepted what the document says, and editing its contents would change that
	 * without leaving a trace - which is the same reason nothing transitions back to `pending`.
	 *
	 * **Options are re-stated with the set.** Each line names its answers by id and
	 * `OrderOptionService` rebuilds the snapshots from the catalog, so a checkout line keeps its
	 * options only when the caller sends them back - the dashboard reads the ids off the stored
	 * snapshots to do so.
	 *
	 * `currency` rides along with that set - the validator refuses it without one - so it is gated
	 * by the same 409 and never reaches `pickValuesFromObject`: it is not a column on `order`, it
	 * belongs to the lines being written. Its rate is looked up rather than accepted, as of the
	 * order's creation.
	 */
	public async updateData(
		entry: OrderEntity,
		data: ValidatorOutput<OrderValidator, 'update'>,
		canDiscount: boolean,
	): Promise<OrderEntity> {
		if (data.client_id) {
			await this.checkClientId(data.client_id);

			// Documents are raised for one client and payments filed under one; neither follows a move
			if (
				data.client_id !== entry.client_id &&
				(await isOrderClientLocked(entry.id))
			) {
				throw new CustomError(409, lang('order.error.client_locked'));
			}
		}

		const clientChanged =
			data.client_id !== undefined && data.client_id !== entry.client_id;
		const billingAddress =
			data.billing_address === undefined
				? entry.billing_address
				: await this.toBillingAddress(data.billing_address);

		if (
			JSON.stringify(billingAddress) !==
			JSON.stringify(entry.billing_address)
		) {
			// The issued document froze the billing details; the order would stop agreeing with it
			if (await isOrderInvoiced(entry.id)) {
				throw new CustomError(409, lang('order.error.billing_locked'));
			}
		}

		if (data.lines) {
			if (entry.status !== OrderStatusEnum.PENDING) {
				throw new CustomError(409, lang('order.error.lines_locked'));
			}

			// Billed up front: a live document froze these lines, and rewriting them under it
			// would leave it billing goods the order no longer lists
			if (await isOrderInvoiced(entry.id)) {
				throw new CustomError(409, lang('order.error.lines_invoiced'));
			}

			await this.checkLines(data.lines);
		}

		/*
		 * Left out alongside a line set, the stored order-wide terms carry over and are
		 * re-apportioned onto the new lines; `null` clears them. The validator refuses them without
		 * a line set, so they never change without the lines they live in being rewritten.
		 */
		const orderDiscount =
			data.discount === undefined
				? toManualTerms(entry.discount)
				: data.discount;

		if (data.lines) {
			await this.assertMayDiscount(
				canDiscount,
				{ discount: orderDiscount, lines: data.lines },
				entry,
			);
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		/*
		 * Set after the generic pass, which would copy the payload as typed - without the country
		 * name `toBillingAddress` fills in. Moved to another client without naming an address, the
		 * one on file was the previous client's, so it is dropped rather than kept billing somebody
		 * else.
		 */
		entry.billing_address =
			data.billing_address === undefined && clientChanged
				? null
				: billingAddress;

		/*
		 * The incoming set is costed before the transaction opens, not inside it: resolving the
		 * discounts reads the catalog, and holding the document's rows locked for the length of
		 * those queries buys nothing. What it reads is committed data either way.
		 */
		const lines = data.lines
			? await this.buildLines(
					entry,
					data.lines,
					data.currency,
					orderDiscount,
				)
			: undefined;

		if (lines) {
			entry.discount = lines.discount;
		}

		// Filled inside the callback, run once it has committed
		const after: AfterCommit[] = [];

		const saved = await dataSource.transaction(async (manager) => {
			const order = await manager.save(entry);

			if (lines) {
				await this.replaceLines(
					manager,
					order.id,
					lines.rows,
					lines.currency,
					lines.exchange_rate,
				);

				/*
				 * In this transaction, the payment request still pending follows the new total, and
				 * the delivery not yet shipped the new goods.
				 */
				for (const run of [
					await syncOrderPayment(manager, order.id),
					await syncOrderDelivery(manager, order.id),
				]) {
					if (run) {
						after.push(run);
					}
				}
			}

			return order;
		});

		await cleanEntityCache(OrderEntity, saved.id);

		for (const run of after) {
			await run();
		}

		return saved;
	}

	/**
	 * Whether a live goods document bills the order, which locks its lines (`updateData`).
	 *
	 * Asked fresh on every read rather than cached with it: the document is raised by `invoice`,
	 * which does not drop this feature's cache, so a cached answer would outlive the change.
	 */
	public isInvoiced(orderId: number): Promise<boolean> {
		return isOrderInvoiced(orderId);
	}

	/**
	 * Whether the order may no longer move to another client (`updateData`) - billed, or paid for,
	 * under the one it names. Asked fresh for the reason `isInvoiced` is.
	 */
	public isClientLocked(orderId: number): Promise<boolean> {
		return isOrderClientLocked(orderId);
	}

	/**
	 * Turns an edited line set into rows ready to write: what they are denominated in, and what
	 * the catalog takes off each of them.
	 *
	 * `currency` and its rate default to what the outgoing lines were written in, which is what a
	 * line edit that says nothing about money means. When the caller does send a currency, the
	 * incoming prices are taken as quoted in it and written as they are: the validator only accepts
	 * a currency alongside a full line set, so the operator has just re-stated every price. Nothing
	 * is converted here - the rate rides along for the accounts to reach base currency with, and
	 * applying it to prices somebody typed would move figures they agreed. It is looked up as of the
	 * order's creation, the same date the discounts below are resolved against.
	 *
	 * The discounts are resolved fresh over the whole set rather than carried across from the rows
	 * being replaced: a changed quantity, price or currency changes which rule wins and what it is
	 * worth, and `min_order_value` reads the document's new total.
	 */
	private async buildLines(
		entry: OrderEntity,
		lines: readonly OrderLinePayload[],
		currency?: string,
		orderDiscount?: ManualDiscount | null,
	): Promise<{
		rows: OrderLineInput[];
		currency: string;
		exchange_rate: number;
		/** The typed order-wide discount as costed over these lines, for `order.discount`. */
		discount: DiscountSnapshot | null;
	}> {
		const denomination = await this.readLineDenomination(entry.id);

		const lineCurrency = currency ?? denomination.currency;
		const exchangeRate = currency
			? await this.resolveExchangeRate(currency, entry.created_at)
			: denomination.exchange_rate;

		const countryCode = entry.billing_address?.country_code ?? null;

		const composed = await this.composeLines(
			lines,
			{
				clientId: entry.client_id,
				countryCode: countryCode,
				currency: lineCurrency,
				exchangeRate: exchangeRate,
				now: entry.created_at,
			},
			orderDiscount,
		);

		return {
			rows: composed.rows,
			currency: lineCurrency,
			exchange_rate: exchangeRate,
			discount: composed.discount,
		};
	}

	/**
	 * What the document's existing lines are denominated in - every line of an order shares one
	 * currency and rate, so the first row answers for the set.
	 */
	private async readLineDenomination(
		orderId: number,
	): Promise<{ currency: string; exchange_rate: number }> {
		const current = await dataSource.getRepository(OrderLineEntity).find({
			select: { id: true, currency: true, exchange_rate: true },
			where: { order_id: orderId },
			withDeleted: true,
			take: 1,
		});

		const first = current[0];

		if (!first) {
			throw new CustomError(500, lang('order.error.lines_missing'));
		}

		return {
			currency: first.currency,
			exchange_rate: first.exchange_rate,
		};
	}

	/**
	 * Swaps a pending order's lines for the set the caller sent.
	 *
	 * The existing rows are removed outright rather than soft-deleted. A line on an order nobody
	 * has accepted yet is not a record of anything - nothing shipped against it - so keeping the
	 * ones an operator typed over would leave every read filtering around them. What they said
	 * before the edit survives in `log_history` for the order, not as rows.
	 */
	private async replaceLines(
		manager: EntityManager,
		orderId: number,
		lines: readonly OrderLineInput[],
		currency: string,
		exchangeRate: number,
	): Promise<void> {
		await manager
			.getRepository(OrderLineEntity)
			.delete({ order_id: orderId });

		await this.writeLines(manager, orderId, lines, currency, exchangeRate);
	}

	/**
	 * Moves an order along its lifecycle, refusing anything `STATUS_TRANSITIONS` does not allow -
	 * a repeat of the current status answers 400, an illegal move 409.
	 *
	 * The cache is dropped after the write rather than by a subscriber: `OrderEntity.HAS_CACHE` is
	 * true, and a subscriber would fire inside the transaction, where a concurrent reader can
	 * refill the cache from a snapshot about to be superseded.
	 *
	 * When the move is the one that accepts the order, it is announced so whatever is still
	 * unbilled is billed - the whole order on the back-office path, nothing on the checkout path,
	 * which billed it when it was placed. Settled documents confirm an order through here too.
	 * It is then announced a second time, for its deliveries still `pending` to be prepared.
	 *
	 * The announcement runs **after the write has committed** and is not part of any transaction
	 * the caller holds - see `invoice.hooks.ts` for why, and for what a failure to raise
	 * the document leaves behind. Confirming the order is the part that must not fail: billing details
	 * an invoice refuses on are the client's to fix, and none of that is a reason to refuse an
	 * operator the status change.
	 */
	public async updateStatus(
		entry: OrderEntity,
		newStatus: OrderStatus,
	): Promise<OrderEntity> {
		if (newStatus === OrderStatusEnum.CANCELED) {
			return this.cancel(entry, { byBuyer: false });
		}

		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		const saved = await this.repository.save(entry);

		await cleanEntityCache(OrderEntity, saved.id);

		if (newStatus === OrderStatusEnum.CONFIRMED) {
			await notifyOrderConfirmed({
				order_id: saved.id,
			});

			await notifyOrderFulfillmentReleased({
				order_id: saved.id,
			});
		}

		return saved;
	}

	/**
	 * Cancels an order and withdraws what still waits on it: the payment requests not yet acted on
	 * (`cancelOrderPayment`, answered by `cart`, in this transaction) and, after the commit, the
	 * deliveries that have not left (`notifyOrderCanceled`, answered by `shipping`).
	 *
	 * **A buyer cancels only what nothing has acted on yet**: a pending order with no invoice and
	 * no money past a request - each of those has to be reversed or refunded, which is the
	 * business's call. An operator cancels past both; the documents and money stay as they are,
	 * for the operator to reverse or refund.
	 *
	 * The order row is locked for the transaction and its status read again under the lock, so a
	 * capture that confirms the order concurrently either lands first - and the cancel is refused -
	 * or finds its request already canceled.
	 */
	public async cancel(
		entry: OrderEntity,
		options: { byBuyer: boolean },
	): Promise<OrderEntity> {
		if (options.byBuyer && (await isOrderInvoiced(entry.id))) {
			throw new CustomError(
				409,
				lang('order.error.not_cancelable_invoiced'),
			);
		}

		const { saved, after } = await dataSource.transaction(
			async (manager) => {
				const locked = await manager
					.getRepository(OrderEntity)
					.findOneOrFail({
						where: { id: entry.id },
						lock: { mode: 'pessimistic_write' },
					});

				if (
					options.byBuyer &&
					locked.status !== OrderStatusEnum.PENDING
				) {
					throw new CustomError(
						409,
						lang('order.error.not_cancelable'),
					);
				}

				assertValidStatusTransition(
					STATUS_TRANSITIONS,
					locked.status,
					OrderStatusEnum.CANCELED,
				);

				const payment = await cancelOrderPayment(manager, locked.id);

				// Thrown inside the transaction, so the requests withdrawn above roll back with it
				if (options.byBuyer && payment.hasProcessed) {
					throw new CustomError(
						409,
						lang('order.error.not_cancelable_paid'),
					);
				}

				locked.status = OrderStatusEnum.CANCELED;

				return {
					saved: await manager.save(locked),
					after: payment.after,
				};
			},
		);

		await cleanEntityCache(OrderEntity, saved.id);

		if (after) {
			await after();
		}

		await notifyOrderCanceled({
			order_id: saved.id,
		});

		return saved;
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public async findById(
		id: number,
		withDeleted = false,
	): Promise<OrderEntity> {
		return this.repository
			.createQuery()
			.withDeleted(withDeleted)
			.filterById(id)
			.firstOrFail();
	}

	/**
	 * @description Used by `invoice` to name the order a cash flow movement is filed under, and the
	 * order a printed document bills
	 *
	 * The reference and the date it was placed, soft-deleted orders included - the movement was
	 * raised for the document whatever became of it since. Also what a printed invoice names its
	 * order by. Null when the id points at nothing: the link is a plain id, with no foreign key to
	 * keep it honest.
	 */
	public findReferenceById(
		id: number,
	): Promise<Pick<
		OrderEntity,
		'id' | 'ref_code' | 'ref_number' | 'created_at'
	> | null> {
		return this.repository
			.createQuery()
			.select([
				'order.id',
				'order.ref_code',
				'order.ref_number',
				'order.created_at',
			])
			.withDeleted(true)
			.filterById(id)
			.first();
	}

	/** The document's lines, in the order they were written - which is the order they read in. */
	/**
	 * @description Used in `create` method from `ReviewService`; the proof behind a verified buyer
	 *
	 * The order on which the account bought the product: a line for it, on an order billed to one
	 * of the account's clients, that reached `completed`. Only `completed` counts - a `confirmed`
	 * order may still be canceled and has not shipped, and the review holds the answer for good.
	 *
	 * When a variant is named, the line has to match it too, since that is what the reviewer
	 * received. Bought more than once, the most recent purchase wins - that is the one the review
	 * is about. Soft-deleted orders, lines and clients count for nothing; TypeORM applies
	 * `deleted_at IS NULL` to each joined entity.
	 *
	 * `LIMIT 1` over plain inner joins is safe here - nothing one-to-many is selected, so the limit
	 * cuts rows, not a hydrated collection.
	 */
	public async findLatestPurchase(
		userId: number,
		productId: number,
		variantId?: number | null,
	): Promise<number | null> {
		const line = await this.lineRepository
			.createQuery()
			.join('order_line.order', 'order', 'INNER')
			.join('order.client', 'client', 'INNER')
			.select(['order_line.id', 'order_line.order_id'])
			.filterBy('product_id', productId)
			.filterBy('variant_id', variantId)
			.filterBy('order.status', OrderStatusEnum.COMPLETED)
			.filterBy('client.user_id', userId)
			.orderBy('order.created_at', OrderDirectionEnum.DESC)
			.orderBy('order.id', OrderDirectionEnum.DESC)
			.getQuery()
			.limit(1)
			.getOne();

		return line?.order_id ?? null;
	}

	public async getLines(orderId: number): Promise<OrderLineWithLabel[]> {
		const lines = await this.lineRepository
			.createQuery()
			.select([...LINE_COLUMNS, ...LINE_VARIANT_COLUMNS])
			.joinAndSelect('order_line.variant', 'variant', 'LEFT')
			.filterBy('order_id', orderId)
			.orderBy('id')
			.all();

		const productIds = [...new Set(lines.map((line) => line.product_id))];

		// One read for every product the document names, at most one row each by the
		// `(product_id, language)` unique index. Soft-deleted content still names what was sold.
		const contents =
			productIds.length === 0
				? []
				: await dataSource.getRepository(ProductContentEntity).find({
						select: { product_id: true, label: true },
						where: {
							product_id: In(productIds),
							language: Configuration.language(),
						},
						withDeleted: true,
					});

		const labelByProduct = new Map(
			contents.map((content) => [content.product_id, content.label]),
		);

		return lines.map((line) =>
			Object.assign(line, {
				label: labelByProduct.get(line.product_id) ?? null,
			}),
		);
	}

	/**
	 * Sums a document, each line at its own VAT rate rather than one rate over the total: a
	 * basket routinely mixes categories, and VAT is owed per line.
	 *
	 * VAT is charged on the line **after** its discount, which is the order the tax is owed in -
	 * the same order `CartPricingService` quotes a basket in, so a checkout's confirmation and the
	 * order it produced state the same figure.
	 *
	 * Rounded per step, so the parts a reader adds up agree with the whole they are shown beside.
	 */
	public computeTotals(lines: OrderLineEntity[]): OrderTotals {
		let subtotal = 0;
		let discountReduction = 0;
		let orderDiscountReduction = 0;
		let vatAmount = 0;
		let hasDiscount = false;

		for (const line of lines) {
			const gross = roundMoney(
				Number(line.price) * Number(line.quantity),
			);
			const reduction = Number(line.discount_reduction);
			const net = roundMoney(gross - reduction);

			subtotal += gross;
			discountReduction += reduction;
			vatAmount += roundMoney((net * Number(line.vat_rate)) / 100);

			if (line.discount && line.discount.length > 0) {
				hasDiscount = true;

				for (const snapshot of line.discount) {
					if (snapshot.scope === DiscountScopeEnum.ORDER) {
						orderDiscountReduction += Number(
							snapshot.reduction ?? 0,
						);
					}
				}
			}
		}

		subtotal = roundMoney(subtotal);
		discountReduction = roundMoney(discountReduction);
		orderDiscountReduction = roundMoney(orderDiscountReduction);
		vatAmount = roundMoney(vatAmount);

		const first = lines[0];

		return {
			currency: first?.currency ?? '',
			exchange_rate: first ? Number(first.exchange_rate) : 1,
			subtotal: subtotal,
			discount_reduction: discountReduction,
			order_discount_reduction: orderDiscountReduction,
			vat_amount: vatAmount,
			total: roundMoney(subtotal - discountReduction + vatAmount),
			has_discount: hasDiscount,
		};
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 *
	 * Two queries rather than one join: a document with twenty lines would otherwise repeat the
	 * order and its client twenty times, and the lines carry their own join for the SKU.
	 */
	public async getEntryData(data: {
		id: number;
		withDeleted: boolean;
	}): Promise<OrderWithLines> {
		const order = await this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...CLIENT_COLUMNS])
			.joinAndSelect('order.client', 'client', 'LEFT')
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();

		const lines = await this.getLines(order.id);

		return Object.assign(order, {
			lines: lines,
			totals: this.computeTotals(lines),
		});
	}

	/**
	 * @description Used in `OrderPublicController` and `ShippingPublicController`; the ownership check
	 *
	 * One of the account's orders, resolved through `client.user_id` in the same query - somebody
	 * else's id reads as missing (404), so no ownership check is left to a later step. A soft-deleted
	 * order or client counts as missing too: TypeORM applies `deleted_at IS NULL` to the join.
	 */
	public findOwnById(id: number, userId: number): Promise<OrderEntity> {
		return this.repository
			.createQuery()
			.select(PUBLIC_ENTRY_COLUMNS)
			.join('order.client', 'client', 'INNER')
			.filterById(id)
			.filterBy('client.user_id', userId)
			.firstOrFail();
	}

	/**
	 * @description Used in `read` method from `OrderPublicController`
	 *
	 * The same shape `getEntryData` returns, minus what the back office alone reads. Not cached:
	 * the `read` key is per order id alone and a per-caller key would only ever be warmed by one
	 * account, while the ownership read has to run on every request regardless.
	 */
	public async getOwnEntryData(
		id: number,
		userId: number,
	): Promise<OrderWithLines> {
		const order = await this.repository
			.createQuery()
			.select([...PUBLIC_ENTRY_COLUMNS, ...PUBLIC_DETAIL_CLIENT_COLUMNS])
			.joinAndSelect('order.client', 'client', 'INNER')
			.filterById(id)
			.filterBy('client.user_id', userId)
			.firstOrFail();

		const lines = await this.getLines(order.id);
		const [withPayment] = await this.attachAwaitingPayment([order]);

		return Object.assign(withPayment, {
			lines: lines,
			totals: this.computeTotals(lines),
		});
	}

	/**
	 * Marks the orders whose buyer still owes the payment they started - `awaiting_payment`, which
	 * the storefront shows in place of `pending`. Not a status: the order is pending either way, and
	 * what moves it on is the capture, through `order-settlement`.
	 *
	 * Only a pending order paid by card or transfer can be waiting. Cash on delivery is collected
	 * with the parcel, so its open request says nothing about the buyer, and an order with no
	 * method - one raised in the back office - was never asked to pay through one. One question
	 * for the whole page, and none at all when no order on it qualifies.
	 */
	private async attachAwaitingPayment<
		T extends {
			id: number;
			status: OrderStatus;
			payment_method: OrderPaymentMethod | null;
		},
	>(orders: T[]): Promise<(T & { awaiting_payment: boolean })[]> {
		const candidates = orders
			.filter(
				(order) =>
					order.status === OrderStatusEnum.PENDING &&
					order.payment_method !== null &&
					order.payment_method !==
						OrderPaymentMethodEnum.CASH_ON_DELIVERY,
			)
			.map((order) => order.id);

		const awaiting =
			candidates.length === 0
				? new Set<number>()
				: await findOrdersAwaitingPayment(candidates);

		return orders.map((order) =>
			Object.assign(order, { awaiting_payment: awaiting.has(order.id) }),
		);
	}

	/**
	 * @description Used in `find` method from `OrderPublicController`
	 *
	 * Every order billed to any of the account's clients. The listing carries no lines or totals,
	 * for the reason `findByFilter` gives - the detail read attaches them.
	 *
	 * Without a status filter a canceled order is left out: a buyer's history is what is still
	 * coming or already came, and an order withdrawn is reached by asking for `canceled` itself.
	 */
	public async findOwnByFilter(
		data: ValidatorOutput<OrderValidator, 'publicFind'>,
		userId: number,
	): Promise<
		[
			(OrderEntity & {
				totals: OrderTotals;
				awaiting_payment: boolean;
			})[],
			number,
		]
	> {
		const [entries, total] = await this.repository
			.createQuery()
			.select([...PUBLIC_ENTRY_COLUMNS, ...CLIENT_COLUMNS])
			.joinAndSelect('order.client', 'client', 'INNER')
			.filterBy('client.user_id', userId)
			.filterBy(
				'status',
				data.filter.status ?? OrderStatusEnum.CANCELED,
				data.filter.status ? '=' : '!=',
			)
			.orderBy(data.order_by, data.direction)
			.orderBy('id', data.direction)
			.pagination(data.page, data.limit)
			.all(true);

		return [
			await this.attachAwaitingPayment(await this.attachTotals(entries)),
			total,
		];
	}

	/**
	 * What each order on a page adds up to - the one figure a buyer scans a history for.
	 *
	 * One read of the money columns for the whole page rather than `getLines` per order: the labels
	 * and SKUs that read resolves are not needed to sum a document, and a page of twenty orders
	 * would otherwise cost forty queries.
	 */
	private async attachTotals(
		orders: OrderEntity[],
	): Promise<(OrderEntity & { totals: OrderTotals })[]> {
		const lines =
			orders.length === 0
				? []
				: await this.lineRepository.find({
						select: {
							order_id: true,
							price: true,
							quantity: true,
							vat_rate: true,
							currency: true,
							exchange_rate: true,
							discount: true,
							discount_reduction: true,
						},
						where: {
							order_id: In(orders.map((order) => order.id)),
						},
					});

		const linesByOrder = new Map<number, OrderLineEntity[]>();

		for (const line of lines) {
			const list = linesByOrder.get(line.order_id) ?? [];

			list.push(line);
			linesByOrder.set(line.order_id, list);
		}

		return orders.map((order) =>
			Object.assign(order, {
				totals: this.computeTotals(linesByOrder.get(order.id) ?? []),
			}),
		);
	}

	public findByFilter(
		data: ValidatorOutput<OrderValidator, 'find'>,
		withDeleted: boolean,
	) {
		const query = this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...CLIENT_COLUMNS])
			.joinAndSelect('order.client', 'client', 'LEFT')
			.filterById(data.filter.id)
			.filterByClient(data.filter.client_id)
			.filterByReference(data.filter.ref_code, data.filter.ref_number)
			.filterByRange(
				'created_at',
				data.filter.create_at_start,
				data.filter.create_at_end,
			);

		// One status narrows with `=`, several with `IN` - the filter accepts both
		if (Array.isArray(data.filter.status)) {
			query.filterBy('status', data.filter.status, 'IN');
		} else {
			query.filterBy('status', data.filter.status);
		}

		/*
		 * The term is applied only when neither reference filter is: both reach for `ref_code` and
		 * `ref_number`, and the query layer names a bound parameter after its column - so a second
		 * condition on the same column replaces the first one's value instead of narrowing further.
		 * A caller who states the reference already said what the term would have.
		 */
		if (!data.filter.ref_code && !data.filter.ref_number) {
			query.filterByTerm(data.filter.term);
		}

		return query
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const orderService = new OrderService(
	getOrderRepository(),
	getOrderLineRepository(),
	clientService,
	clientAddressService,
	orderDiscountService,
	orderOptionService,
	orderBundleService,
);
