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
	type OrderPaymentMethod,
	type OrderStatus,
	OrderStatusEnum,
	type OrderType,
	OrderTypeEnum,
	STATUS_TRANSITIONS,
} from '@/features/order/order.entity';
import {
	getOrderLineRepository,
	getOrderRepository,
} from '@/features/order/order.repository';
import {
	type OrderValidator,
	paramsUpdateList,
} from '@/features/order/order.validator';
import {
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
	 * currency and resolves none - leaves it out, and the document resolves its own as of the
	 * issue date. Stated only by a caller that already froze the money at a known rate.
	 */
	exchange_rate?: number;
	lines: readonly OrderLineInput[];
	type?: OrderType;
	/** How the client pays. Absent on a back-office document that has not agreed it yet. */
	payment_method?: OrderPaymentMethod | null;
	/**
	 * The client address the order is billed to. Absent on a back-office document that has not
	 * agreed one yet.
	 *
	 * The caller is what proves the address belongs to the billed client - a checkout resolves it
	 * through `ClientAddressService.getOrderSnapshot`, which answers a 404 for anybody else's.
	 */
	billing_address_id?: number | null;
	notes?: string | null;
	/** Defaults to now. Injectable so a backdated import states its own date. */
	issued_at?: Date;
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

const ENTRY_COLUMNS = [
	'order.id',
	'order.client_id',
	'order.ref_code',
	'order.ref_number',
	'order.status',
	'order.type',
	'order.payment_method',
	'order.billing_address_id',
	'order.issued_at',
	'order.notes',
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

const LINE_COLUMNS = [
	'order_line.id',
	'order_line.order_id',
	'order_line.parent_id',
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
	 * The rate the document's money is frozen at, read from `exchange_rate` rather than accepted
	 * from the caller. A back-office operator agrees prices, not the rate the accounts convert
	 * them at, and a figure typed into the payload is one nobody can reconcile against the
	 * published series later.
	 *
	 * Taken **as of the issue date**, not today: a backdated order is converted at what the day
	 * it was issued was worth, and `getRateAsOf` carries the previous publication forward across
	 * a weekend or a holiday.
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
		issuedAt?: Date,
	): Promise<number> {
		const rate = await exchangeRateService.getRateAsOf(currency, issuedAt);

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

		const issuedAt = data.issued_at ?? new Date();

		/*
		 * The rate belongs to the document rather than to whoever raised it. A checkout hands over
		 * figures in the shopper's currency and no rate at all, so this is the moment the money is
		 * frozen - and an unpublished currency is refused here rather than converted at a made-up
		 * rate, the same bar the back-office path holds.
		 */
		const exchangeRate =
			data.exchange_rate ??
			(await this.resolveExchangeRate(data.currency, issuedAt));

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
				type: data.type ?? OrderTypeEnum.STANDARD,
				payment_method: data.payment_method ?? null,
				billing_address_id: data.billing_address_id ?? null,
				issued_at: issuedAt,
				notes: data.notes ?? null,
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
	): Promise<OrderEntity> {
		await this.checkClientId(data.client_id);
		await this.checkLines(data.lines);

		const exchangeRate = await this.resolveExchangeRate(
			data.currency,
			data.issued_at ?? undefined,
		);

		const issuedAt = data.issued_at ?? new Date();

		const options = await this.optionService.resolveForLines(
			data.lines,
			data.currency,
		);

		/*
		 * The buyer's country, for a campaign that names one. A back-office document may not have
		 * agreed a billing address yet, and every country condition then fails closed - which is
		 * the same answer the storefront gives a basket that has chosen none.
		 */
		const countryCode = data.billing_address_id
			? await this.clientAddressService.getCountryCodeById(
					data.billing_address_id,
				)
			: null;

		const discounts = await this.discountService.resolveForLines(
			data.lines,
			{
				clientId: data.client_id,
				countryCode: countryCode,
				currency: data.currency,
				exchangeRate: exchangeRate,
				now: issuedAt,
			},
		);

		return dataSource.transaction((manager) =>
			this.create(manager, {
				client_id: data.client_id,
				currency: data.currency,
				exchange_rate: exchangeRate,
				type: data.type,
				billing_address_id: data.billing_address_id ?? null,
				issued_at: issuedAt,
				notes: data.notes ?? null,
				lines: data.lines.map((line, index) => ({
					variant_id: line.variant_id,
					product_id: line.product_id,
					quantity: line.quantity,
					price: line.price,
					vat_rate: line.vat_rate,
					discount: discounts.lines[index]?.snapshots ?? null,
					discount_reduction: discounts.lines[index]?.reduction ?? 0,
					options: options[index],
					notes: line.notes ?? null,
				})),
			}),
		);
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
	 * belongs to the lines being written. Its rate is looked up rather than accepted, against the
	 * issue date the document ends the call with, so re-denominating a pending order and
	 * backdating it in one request converts at the date that was actually saved.
	 */
	public async updateData(
		entry: OrderEntity,
		data: ValidatorOutput<OrderValidator, 'update'>,
	): Promise<OrderEntity> {
		if (data.client_id) {
			await this.checkClientId(data.client_id);
		}

		if (data.lines) {
			if (entry.status !== OrderStatusEnum.PENDING) {
				throw new CustomError(409, lang('order.error.lines_locked'));
			}

			await this.checkLines(data.lines);
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		/*
		 * The incoming set is costed before the transaction opens, not inside it: resolving the
		 * discounts reads the catalog, and holding the document's rows locked for the length of
		 * those queries buys nothing. What it reads is committed data either way.
		 */
		const lines = data.lines
			? await this.buildLines(entry, data.lines, data.currency)
			: undefined;

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
			}

			return order;
		});

		await cleanEntityCache(OrderEntity, saved.id);

		return saved;
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
	 * applying it to prices somebody typed would move figures they agreed. It is looked up against
	 * the issue date the document ends the call with, so re-denominating a pending order and
	 * backdating it in one request converts at the date that was actually saved.
	 *
	 * The discounts are resolved fresh over the whole set rather than carried across from the rows
	 * being replaced: a changed quantity, price or currency changes which rule wins and what it is
	 * worth, and `min_order_value` reads the document's new total.
	 */
	private async buildLines(
		entry: OrderEntity,
		lines: readonly OrderLinePayload[],
		currency?: string,
	): Promise<{
		rows: OrderLineInput[];
		currency: string;
		exchange_rate: number;
	}> {
		const denomination = await this.readLineDenomination(entry.id);

		const lineCurrency = currency ?? denomination.currency;
		const exchangeRate = currency
			? await this.resolveExchangeRate(currency, entry.issued_at)
			: denomination.exchange_rate;

		const options = await this.optionService.resolveForLines(
			lines,
			lineCurrency,
		);

		const countryCode = entry.billing_address_id
			? await this.clientAddressService.getCountryCodeById(
					entry.billing_address_id,
				)
			: null;

		const discounts = await this.discountService.resolveForLines(lines, {
			clientId: entry.client_id,
			countryCode: countryCode,
			currency: lineCurrency,
			exchangeRate: exchangeRate,
			now: entry.issued_at,
		});

		return {
			rows: lines.map((line, index) => ({
				variant_id: line.variant_id,
				product_id: line.product_id,
				quantity: line.quantity,
				price: line.price,
				vat_rate: line.vat_rate,
				discount: discounts.lines[index]?.snapshots ?? null,
				discount_reduction: discounts.lines[index]?.reduction ?? 0,
				options: options[index],
				notes: line.notes ?? null,
			})),
			currency: lineCurrency,
			exchange_rate: exchangeRate,
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
	 */
	public async updateStatus(
		entry: OrderEntity,
		newStatus: OrderStatus,
	): Promise<OrderEntity> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		const saved = await this.repository.save(entry);

		await cleanEntityCache(OrderEntity, saved.id);

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
			.orderBy('order.issued_at', OrderDirectionEnum.DESC)
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
			.filterBy('status', data.filter.status)
			.filterBy('type', data.filter.type)
			.filterByReference(data.filter.ref_code, data.filter.ref_number)
			.filterByRange(
				'issued_at',
				data.filter.issued_at_start,
				data.filter.issued_at_end,
			);

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
);
