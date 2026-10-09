import {
	type DeepPartial,
	type EntityManager,
	In,
	MoreThan,
	Not,
} from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError } from '@/exceptions';
import {
	type AddressService,
	addressService,
} from '@/features/address/address.service';
import {
	type CarrierService,
	carrierService,
} from '@/features/carrier/carrier.service';
import {
	type ClientAddressService,
	clientAddressService,
} from '@/features/client-address/client-address.service';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import { OrderStatusEnum } from '@/features/order/order.entity';
import {
	type OrderService,
	orderService,
} from '@/features/order/order.service';
import OrderLineEntity from '@/features/order/order-line.entity';
import ProductEntity, {
	ProductTypeEnum,
} from '@/features/product/product.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ShippingEntity, {
	type ShippingMethod,
	ShippingMethodEnum,
	type ShippingScope,
	ShippingScopeEnum,
	type ShippingStatus,
	ShippingStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/shipping/shipping.entity';
import { notifyShippingChanged } from '@/features/shipping/shipping.hooks';
import { getShippingRepository } from '@/features/shipping/shipping.repository';
import {
	paramsUpdateList,
	type ShippingValidator,
} from '@/features/shipping/shipping.validator';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import {
	quoteShipping,
	type ShippingRateService,
	shippingRateService,
} from '@/features/shipping/shipping-rate.service';
import {
	type WarehouseService,
	warehouseService,
} from '@/features/warehouse/warehouse.service';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { roundMoney } from '@/helpers/shop.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

const ENTRY_COLUMNS = [
	'shipping.id',
	'shipping.scope',
	'shipping.order_id',
	'shipping.document_ref',
	'shipping.status',
	'shipping.method',
	'shipping.carrier_id',
	'shipping.pickup_warehouse_id',
	'shipping.pickup_client_address_id',
	'shipping.destination_warehouse_id',
	'shipping.destination_client_address_id',
	'shipping.pickup_data',
	'shipping.destination_data',
	'shipping.tracking_number',
	'shipping.tracking_url',
	'shipping.vat_rate',
	'shipping.price',
	'shipping.operational_cost',
	'shipping.currency',
	'shipping.exchange_rate',
	'shipping.discount',
	'shipping.discount_reduction',
	'shipping.contact_name',
	'shipping.contact_phone',
	'shipping.contact_email',
	'shipping.shipped_at',
	'shipping.delivered_at',
	'shipping.estimated_delivery_at',
	'shipping.notes',
	'shipping.created_at',
	'shipping.updated_at',
	'shipping.deleted_at',
];

const ORDER_COLUMNS = [
	'order.id',
	'order.client_id',
	'order.ref_code',
	'order.ref_number',
	'order.status',
];

const PICKUP_WAREHOUSE_COLUMNS = [
	'pickup_warehouse.id',
	'pickup_warehouse.code',
	'pickup_warehouse.name',
];

const DESTINATION_WAREHOUSE_COLUMNS = [
	'destination_warehouse.id',
	'destination_warehouse.code',
	'destination_warehouse.name',
];

const CARRIER_COLUMNS = ['carrier.id', 'carrier.name'];

/** The moves that take goods forward - out of the warehouse's hands, towards the buyer. */
const ADVANCING_STATUSES = [
	ShippingStatusEnum.PREPARING,
	ShippingStatusEnum.SHIPPED,
	ShippingStatusEnum.DELIVERED,
] as const;

/** Movements that never carried anything, so nothing is billed or asked for them. */
const UNBILLED_STATUSES = [
	ShippingStatusEnum.FAILED,
	ShippingStatusEnum.CANCELED,
] as const;

/**
 * A movement as the buyer it is delivered to sees it: where it stands, how it travels, what it was
 * charged and how to follow it. Everything the business reads about its own side stays off - the
 * operational cost, the internal notes, the contact snapshot, the allocation ids and the exchange
 * rate. The discount snapshot stays off too: `discount_reduction` is the figure, and the rule's
 * conditions are the business's own.
 */
const PUBLIC_ENTRY_COLUMNS = [
	'shipping.id',
	'shipping.scope',
	'shipping.order_id',
	'shipping.status',
	'shipping.method',
	'shipping.destination_data',
	'shipping.price',
	'shipping.vat_rate',
	'shipping.currency',
	'shipping.discount_reduction',
	'shipping.tracking_number',
	'shipping.tracking_url',
	'shipping.shipped_at',
	'shipping.delivered_at',
	'shipping.estimated_delivery_at',
	'shipping.created_at',
	'shipping.updated_at',
];

/** Only the name: a self-pickup buyer needs to know where to collect, not the warehouse code. */
const PUBLIC_PICKUP_WAREHOUSE_COLUMNS = [
	'pickup_warehouse.id',
	'pickup_warehouse.name',
];

/** One line as the payload states it, after validation. */
type ShippingLinePayload = ValidatorOutput<
	ShippingValidator,
	'create'
>['lines'];

/**
 * What `createWithin` writes from: the validated create payload, plus the exchange rate a checkout
 * freezes alongside its order. A back-office create leaves it at 1, the column default.
 */
type ShippingCreatePayload = ValidatorOutput<ShippingValidator, 'create'>;
type ShippingCreateRequired =
	| 'scope'
	| 'method'
	| 'price'
	| 'vat_rate'
	| 'currency';

export type ShippingCreateInput = Required<
	Pick<ShippingCreatePayload, ShippingCreateRequired>
> &
	Partial<Omit<ShippingCreatePayload, ShippingCreateRequired>> & {
		exchange_rate?: number;
		/** The `shipping`-scope discount a checkout resolved; a back-office create states none. */
		discount?: DiscountSnapshot[] | null;
		discount_reduction?: number;
	};

/** The movement as `read` hands it over, with what travels in it attached. */
export type ShippingWithLines = ShippingEntity & {
	lines: ShippingLineWithLabel[];
	/** The client-address ends named in one line each - null when unset. The list carries them too. */
	pickup_client_address_label: string | null;
	destination_client_address_label: string | null;
};

/** A line with the variant's SKU and the product's name attached; either is null when unresolved. */
export type ShippingLineWithLabel = ShippingLineEntity & {
	sku: string | null;
	label: string | null;
};

/**
 * Which columns each scope uses, in one place.
 *
 * Every rule that depends on the scope - what must be present at create, what a read joins, what an
 * edit may still touch - reads from this rather than repeating a switch. The table's CHECK
 * constraints enforce the mirror image of it: they forbid the ends a scope has no use for, and
 * cannot demand the ones it needs, because the client-address keys are `ON DELETE SET NULL`.
 */
const SCOPE_SHAPE: Record<
	ShippingScope,
	{
		pickup: 'pickup_warehouse_id' | 'pickup_client_address_id';
		destination:
			| 'destination_warehouse_id'
			| 'destination_client_address_id';
		document: 'order_id' | 'document_ref';
	}
> = {
	[ShippingScopeEnum.DELIVERY]: {
		pickup: 'pickup_warehouse_id',
		destination: 'destination_client_address_id',
		document: 'order_id',
	},
	[ShippingScopeEnum.RELOCATION]: {
		pickup: 'pickup_warehouse_id',
		destination: 'destination_warehouse_id',
		document: 'document_ref',
	},
	[ShippingScopeEnum.RETURN]: {
		pickup: 'pickup_client_address_id',
		destination: 'destination_warehouse_id',
		document: 'order_id',
	},
};

/**
 * Physical movements of goods: out to a client, between two warehouses, or back from one.
 *
 * **`scope` decides what every other column means** - which table each end points at, and which
 * document the movement answers to. It is fixed when the row is written: changing it would re-point
 * both ends while the lines, the frozen snapshots and any stock already posted still describe the
 * old shape.
 *
 * **A document may have several movements.** Each leaves from its own site, which is what lets one
 * order ship from two warehouses, and `shipping_line` records what travelled in which - so nothing
 * is sent twice and what is still outstanding is answerable.
 */
export class ShippingService {
	constructor(
		private repository: ReturnType<typeof getShippingRepository>,
		private shippingRateService: ShippingRateService,
		private orderService: OrderService,
		private warehouseService: WarehouseService,
		private carrierService: CarrierService,
		private clientAddressService: ClientAddressService,
		private addressService: AddressService,
	) {}

	/**
	 * Resolves every id a payload carries, so a bad one answers with the owning feature's 404 rather
	 * than a masked 500 from the constraint behind it.
	 *
	 * `document_ref` is not among them: the relocation document has no table yet, so there is
	 * nothing to resolve it against.
	 *
	 * `withDeleted` is false throughout - a movement must not be filed against an order, a site, an
	 * address or a carrier somebody removed.
	 */
	private async checkReferences(data: {
		order_id?: number | null;
		pickup_warehouse_id?: number | null;
		destination_warehouse_id?: number | null;
		pickup_client_address_id?: number | null;
		destination_client_address_id?: number | null;
		carrier_id?: number | null;
	}): Promise<void> {
		if (data.order_id) {
			await this.orderService.findById(data.order_id, false);
		}

		for (const warehouseId of [
			data.pickup_warehouse_id,
			data.destination_warehouse_id,
		]) {
			if (warehouseId) {
				await this.warehouseService.findById(warehouseId, false);
			}
		}

		for (const addressId of [
			data.pickup_client_address_id,
			data.destination_client_address_id,
		]) {
			if (addressId) {
				await this.clientAddressService.findById(addressId);
			}
		}

		if (data.carrier_id) {
			await this.carrierService.findById(data.carrier_id, false);
		}
	}

	/**
	 * Keeps only the ends and the document the scope has a use for, and refuses a row that is
	 * missing one of them.
	 *
	 * Both halves matter. Dropping the columns another scope would have used is what stops a
	 * `delivery` from also naming a destination warehouse - the CHECK would refuse it, as a 500.
	 * Requiring the two it does use is the half the database cannot do, for the `SET NULL` reason
	 * above, so it is enforced here or nowhere.
	 *
	 * **A `self_pickup` delivery has no destination.** The client collects the goods at the pickup
	 * warehouse, so there is no address to send them to - and one sent anyway is dropped, since
	 * freezing it on dispatch would record a journey that never happened.
	 */
	private resolveScopeColumns(
		scope: ShippingScope,
		method: ShippingMethod,
		data: {
			order_id?: number | null;
			document_ref?: number | null;
			pickup_warehouse_id?: number | null;
			pickup_client_address_id?: number | null;
			destination_warehouse_id?: number | null;
			destination_client_address_id?: number | null;
		},
	): Pick<
		ShippingEntity,
		| 'order_id'
		| 'document_ref'
		| 'pickup_warehouse_id'
		| 'pickup_client_address_id'
		| 'destination_warehouse_id'
		| 'destination_client_address_id'
	> {
		const shape = SCOPE_SHAPE[scope];

		const pickup = data[shape.pickup] ?? null;
		const isCollected =
			scope === ShippingScopeEnum.DELIVERY &&
			method === ShippingMethodEnum.SELF_PICKUP;
		const destination = isCollected
			? null
			: (data[shape.destination] ?? null);
		const document = data[shape.document] ?? null;

		if (!pickup) {
			throw new BadRequestError(
				lang('shipping.error.pickup_required', { scope: scope }),
			);
		}

		if (!destination && !isCollected) {
			throw new BadRequestError(
				lang('shipping.error.destination_required', { scope: scope }),
			);
		}

		if (!document) {
			throw new BadRequestError(
				lang('shipping.error.document_required', { scope: scope }),
			);
		}

		return {
			order_id: shape.document === 'order_id' ? document : null,
			document_ref: shape.document === 'document_ref' ? document : null,
			pickup_warehouse_id:
				shape.pickup === 'pickup_warehouse_id' ? pickup : null,
			pickup_client_address_id:
				shape.pickup === 'pickup_client_address_id' ? pickup : null,
			destination_warehouse_id:
				shape.destination === 'destination_warehouse_id'
					? destination
					: null,
			destination_client_address_id:
				shape.destination === 'destination_client_address_id'
					? destination
					: null,
		};
	}

	/**
	 * Proves a line set can be written: every variant is on the order the movement serves, and none
	 * is over-committed once the order's other movements are counted.
	 *
	 * **Counted per variant, not per order line.** A line names a variant rather than an order line,
	 * because a `relocation` has no order behind it at all - so what is still outstanding is the
	 * order's quantity for that variant minus what its other movements already carry. An order that
	 * lists the same variant on two lines is therefore treated as one pool, which is also how a
	 * picker would read it.
	 *
	 * Skipped entirely when there is no order: a relocation is measured against stock on hand, which
	 * is `grn_item.qty_remaining`'s job and not this table's.
	 *
	 * `excludeShippingId` leaves the movement being edited out of the count, so re-stating its own
	 * lines is not read as a second claim. Soft-deleted lines do not count - a withdrawn movement
	 * releases what it held.
	 */
	private async assertLinesAllocatable(
		manager: EntityManager,
		orderId: number | null,
		lines: ShippingLinePayload,
		excludeShippingId?: number,
	): Promise<void> {
		if (!lines || lines.length === 0 || !orderId) {
			return;
		}

		const orderLines = await manager.getRepository(OrderLineEntity).find({
			select: { id: true, variant_id: true, quantity: true },
			where: { order_id: orderId },
		});

		const orderedByVariant = new Map<number, number>();

		for (const line of orderLines) {
			orderedByVariant.set(
				line.variant_id,
				(orderedByVariant.get(line.variant_id) ?? 0) +
					Number(line.quantity),
			);
		}

		const allocated = await manager
			.getRepository(ShippingLineEntity)
			.createQueryBuilder('line')
			.innerJoin(
				ShippingEntity,
				'shipping',
				'shipping.id = line.shipping_id AND shipping.deleted_at IS NULL',
			)
			.where('shipping.order_id = :orderId', { orderId: orderId })
			.andWhere('line.deleted_at IS NULL')
			.andWhere(
				excludeShippingId
					? 'line.shipping_id != :excludeShippingId'
					: '1 = 1',
				excludeShippingId
					? { excludeShippingId: excludeShippingId }
					: {},
			)
			.select('line.variant_id', 'variant_id')
			.addSelect('SUM(line.quantity)', 'allocated')
			.groupBy('line.variant_id')
			.getRawMany<{ variant_id: number; allocated: string }>();

		const allocatedByVariant = new Map(
			allocated.map((row) => [
				Number(row.variant_id),
				Number(row.allocated),
			]),
		);

		for (const line of lines) {
			const ordered = orderedByVariant.get(line.variant_id);

			// 422: a rule the editor acts on by dropping the line, and the dashboard shows it as is
			if (ordered === undefined) {
				throw new CustomError(
					422,
					lang('shipping.error.invalid_line', {
						variant_id: String(line.variant_id),
					}),
				);
			}

			const remaining =
				ordered - (allocatedByVariant.get(line.variant_id) ?? 0);

			if (line.quantity > remaining) {
				throw new CustomError(
					409,
					lang('shipping.error.over_allocated', {
						variant_id: String(line.variant_id),
						remaining: String(remaining),
					}),
				);
			}
		}
	}

	/**
	 * Replaces a movement's lines with the set the caller sent.
	 *
	 * The existing rows are removed outright rather than soft-deleted: a line is a statement about
	 * what is in a consignment, not a record of anything that happened, and keeping the superseded
	 * ones would leave the remaining-quantity check filtering around them.
	 */
	private async writeLines(
		manager: EntityManager,
		shippingId: number,
		lines: ShippingLinePayload,
	): Promise<void> {
		await manager
			.getRepository(ShippingLineEntity)
			.delete({ shipping_id: shippingId });

		if (!lines || lines.length === 0) {
			return;
		}

		await manager.save(
			lines.map((line) =>
				manager.create(ShippingLineEntity, {
					shipping_id: shippingId,
					variant_id: line.variant_id,
					product_id: line.product_id,
					quantity: line.quantity,
					notes: line.notes ?? null,
				}),
			),
		);
	}

	/**
	 * @description Used in `create` method from controller;
	 *
	 * The movement and its lines are written in one transaction: a consignment that failed to record
	 * what is in it is not one anybody can pick.
	 *
	 * Announced once committed, so a priced movement added to an order that is already billed gets
	 * a document of its own - see `invoice.hooks.ts`. A checkout's first delivery goes
	 * through `createWithin` and is not announced: the order it belongs to is billed whole once
	 * the checkout commits.
	 */
	public async create(
		data: ValidatorOutput<ShippingValidator, 'create'>,
	): Promise<ShippingEntity> {
		await this.checkReferences(data);

		const input = await this.withRateDefaults(data);

		const entry = await dataSource.transaction((manager) =>
			this.createWithin(manager, input),
		);

		await notifyShippingChanged({
			shipping_id: entry.id,
			order_id: entry.order_id,
		});

		return entry;
	}

	/**
	 * Fills what the operator left out of a back-office create from the flat-rate table
	 * (`quoteShipping`): the price and VAT rate as a pair, and the operational cost on its own.
	 * Anything stated is kept - an operator agreeing a figure on the phone is the one deciding it.
	 *
	 * The rate is judged by the client address the goods travel to (a delivery) or from (a return).
	 * Quoting in a currency other than the base one needs the published exchange rate, which is then
	 * written onto the row too, so the stored price and the rate it was converted at agree.
	 *
	 * No discount is resolved here: the operator states the price, the same way they state a line
	 * price on a back-office order. A shipping discount applies at checkout.
	 */
	private async withRateDefaults(
		data: ValidatorOutput<ShippingValidator, 'create'>,
	): Promise<ShippingCreateInput> {
		// The validator allows the pair only together, so one being absent means both are
		const needsPrice = data.price === undefined;
		const needsCost =
			data.operational_cost === undefined ||
			data.operational_cost === null;

		if (!needsPrice && !needsCost) {
			return {
				...data,
				price: data.price ?? 0,
				vat_rate: data.vat_rate ?? 0,
			};
		}

		const exchangeRate =
			needsPrice && data.currency !== Configuration.get('app.currency')
				? await this.orderService.resolveExchangeRate(data.currency)
				: 1;

		const quote = quoteShipping({
			scope: data.scope,
			method: data.method,
			countryCode: await this.shippingRateService.resolveCountryCode(
				data.scope === ShippingScopeEnum.RETURN
					? data.pickup_client_address_id
					: data.destination_client_address_id,
			),
			exchangeRate: exchangeRate,
		});

		return {
			...data,
			price: needsPrice ? quote.price : (data.price ?? 0),
			vat_rate: needsPrice ? quote.vat_rate : (data.vat_rate ?? 0),
			operational_cost: needsCost
				? quote.operational_cost
				: data.operational_cost,
			...(needsPrice ? { exchange_rate: exchangeRate } : {}),
		};
	}

	/**
	 * Writes a movement and its lines inside a transaction the caller already holds - the scope
	 * rules and the allocation check apply exactly as they do to a back-office create.
	 *
	 * Public for the checkout, which raises the order's first delivery in the same transaction as
	 * the order itself. The references are not re-resolved here: `create` does that before the
	 * transaction opens, and a checkout has already proved each id it passes is the buyer's own.
	 */
	public async createWithin(
		manager: EntityManager,
		data: ShippingCreateInput,
	): Promise<ShippingEntity> {
		const columns = this.resolveScopeColumns(data.scope, data.method, data);

		await this.assertLinesAllocatable(
			manager,
			columns.order_id,
			data.lines,
		);

		const entry = await manager.save(
			manager.create(ShippingEntity, {
				scope: data.scope,
				...columns,
				carrier_id: data.carrier_id ?? null,
				status: ShippingStatusEnum.PENDING,
				method: data.method,
				tracking_number: data.tracking_number || null,
				tracking_url: data.tracking_url || null,
				price: data.price,
				discount: data.discount ?? null,
				discount_reduction: data.discount_reduction ?? 0,
				operational_cost: data.operational_cost ?? null,
				vat_rate: data.vat_rate,
				currency: data.currency,
				exchange_rate: data.exchange_rate ?? 1,
				contact_name: data.contact_name || null,
				contact_phone: data.contact_phone || null,
				contact_email: data.contact_email || null,
				estimated_delivery_at: data.estimated_delivery_at ?? null,
				notes: data.notes || null,
			}),
		);

		await this.writeLines(manager, entry.id, data.lines);

		return entry;
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ShippingEntity> & { id: number },
	): Promise<ShippingEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ShippingEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 *
	 * **Both ends are editable only while the goods have not left.** Once the movement is `shipped`
	 * they are frozen in `pickup_data` and `destination_data`, and moving either afterwards would
	 * make the document disagree with where the goods physically went.
	 *
	 * The scope is never among the changes - it is not in `paramsUpdateList`, so a body carrying one
	 * is dropped by `pickValuesFromObject` rather than refused, the same way `status` is.
	 */
	public async updateData(
		entry: ShippingEntity,
		data: ValidatorOutput<ShippingValidator, 'update'>,
	): Promise<ShippingEntity> {
		// Withdrawn with its order: nothing about it will happen, so nothing about it is restated
		if (entry.status === ShippingStatusEnum.CANCELED) {
			throw new CustomError(409, lang('shipping.error.canceled_locked'));
		}

		await this.checkReferences(data);

		const hasLeft =
			entry.status !== ShippingStatusEnum.PENDING &&
			entry.status !== ShippingStatusEnum.PREPARING;

		// A method change moves an end too: switching to `self_pickup` drops the destination
		const movesAnEnd =
			data.pickup_warehouse_id !== undefined ||
			data.pickup_client_address_id !== undefined ||
			data.destination_warehouse_id !== undefined ||
			data.destination_client_address_id !== undefined ||
			(data.method !== undefined && data.method !== entry.method);

		if (hasLeft && movesAnEnd) {
			throw new CustomError(409, lang('shipping.error.ends_locked'));
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		/*
		 * A price lowered under what a checkout discount took off would leave a negative net. The
		 * reduction follows it down - the rule cannot take off more than there is - and the snapshot
		 * is kept in step, since it states the same figure.
		 */
		if (entry.discount_reduction > entry.price) {
			entry.discount_reduction = entry.price;
			entry.discount = entry.discount?.map((snapshot) => ({
				...snapshot,
				reduction: entry.price,
			}));
		}

		/*
		 * Re-resolved against the row's own scope, so an edit cannot leave an end the scope has no
		 * use for set - and so the same required/forbidden rule applies on the way in as at create.
		 */
		Object.assign(
			entry,
			this.resolveScopeColumns(entry.scope, entry.method, entry),
		);

		const saved = await dataSource.transaction(async (manager) => {
			if (data.lines) {
				await this.assertLinesAllocatable(
					manager,
					entry.order_id,
					data.lines,
					entry.id,
				);
			}

			const shipping = await manager.save(entry);

			if (data.lines) {
				await this.writeLines(manager, shipping.id, data.lines);
			}

			return shipping;
		});

		await cleanEntityCache(ShippingEntity, saved.id);

		return saved;
	}

	/**
	 * The end as it stands right now, flattened. A warehouse resolves through its address, a client
	 * address through its own service, which folds in the flat/floor note a warehouse does not have.
	 */
	private async snapshotEnd(
		warehouseId: number | null,
		clientAddressId: number | null,
	): Promise<ShippingEntity['pickup_data']> {
		if (clientAddressId) {
			return this.clientAddressService.getSnapshotById(clientAddressId);
		}

		if (warehouseId) {
			const warehouse = await this.warehouseService.findById(
				warehouseId,
				true,
			);

			return this.addressService.getSnapshotById(warehouse.address_id);
		}

		return null;
	}

	/**
	 * Moves a consignment along its lifecycle, refusing anything `STATUS_TRANSITIONS` does not allow
	 * - a repeat of the current status answers 400, an illegal move 409.
	 *
	 * **The move into `shipped` freezes both ends.** Up to that point the live references are the
	 * better answer, since a correction before dispatch should reach the goods; from it on, where
	 * they actually left from and went to is what the document has to keep, whatever is edited or
	 * deleted afterwards. An end whose row has already been removed freezes as null.
	 *
	 * `shipped_at` and `delivered_at` are stamped by the same moves and never re-stamped: they
	 * record when something happened, so a correction that revisits a state must not move them.
	 *
	 * **A delivery leaves `pending` only once its order is accepted.** A pending order is still
	 * editable - its lines, and with them what the delivery carries (`syncLinesForOrder`) - so goods
	 * prepared or handed over before then could disagree with what is finally billed. Withdrawing
	 * it (`failed`, `canceled`) stays open whatever the order's status.
	 *
	 * Every move is announced once written: a delivery arriving can complete the order it
	 * belongs to, and a failed one stops being billable.
	 */
	public async updateStatus(
		entry: ShippingEntity,
		newStatus: ShippingStatus,
	): Promise<ShippingEntity> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		if (
			entry.scope === ShippingScopeEnum.DELIVERY &&
			entry.order_id &&
			ADVANCING_STATUSES.some((status) => status === newStatus)
		) {
			const order = await this.orderService.findById(entry.order_id);

			if (
				order.status !== OrderStatusEnum.CONFIRMED &&
				order.status !== OrderStatusEnum.COMPLETED
			) {
				throw new CustomError(
					409,
					lang('shipping.error.order_not_confirmed'),
				);
			}
		}

		if (newStatus === ShippingStatusEnum.SHIPPED) {
			if (!entry.pickup_data) {
				entry.pickup_data = await this.snapshotEnd(
					entry.pickup_warehouse_id,
					entry.pickup_client_address_id,
				);
			}

			if (!entry.destination_data) {
				entry.destination_data = await this.snapshotEnd(
					entry.destination_warehouse_id,
					entry.destination_client_address_id,
				);
			}

			entry.shipped_at = entry.shipped_at ?? new Date();
		}

		if (newStatus === ShippingStatusEnum.DELIVERED) {
			entry.delivered_at = entry.delivered_at ?? new Date();
		}

		entry.status = newStatus;

		const saved = await this.update(entry);

		await notifyShippingChanged({
			shipping_id: saved.id,
			order_id: saved.order_id,
		});

		return saved;
	}

	/**
	 * @description Used by `shipping.bootstrap.ts` once an order is confirmed
	 *
	 * Moves the order's deliveries still `pending` to `preparing`. Deliveries only - a `return`
	 * names the order too, but goods coming back are not prepared because the order was accepted.
	 * Each goes through `updateStatus`, so it is announced like an operator's move.
	 */
	public async prepareForOrder(orderId: number): Promise<void> {
		const pending = await this.repository
			.createQuery()
			.filterBy('order_id', orderId)
			.filterBy('scope', ShippingScopeEnum.DELIVERY)
			.filterBy('status', ShippingStatusEnum.PENDING)
			.all();

		for (const entry of pending) {
			await this.updateStatus(entry, ShippingStatusEnum.PREPARING);
		}
	}

	/**
	 * @description Used by `shipping.bootstrap.ts`, inside the transaction that rewrites a pending
	 * order's lines
	 *
	 * Rewrites what the order's delivery carries from the order's lines as they now stand, on the
	 * rules a checkout writes them by: a bundle header is left out and its components kept, only
	 * physical products travel, one line per variant with the quantities summed. A note an
	 * operator left on a variant still carried is kept.
	 *
	 * **Only when there is one delivery to follow.** Exactly one delivery that has not been
	 * canceled or failed, and it has not shipped. Goods already with the carrier cannot be
	 * re-listed, and with several deliveries how the goods split between them is the operator's
	 * call - so in those cases nothing moves. Nor when the order has nothing physical left: an
	 * empty parcel is not a delivery, and whether to cancel it is the operator's call too.
	 *
	 * Read and written through the caller's manager, so it sees the lines it was called for.
	 * Returns the id it rewrote, for the caller to drop its cache once the transaction commits.
	 */
	public async syncLinesForOrder(
		manager: EntityManager,
		orderId: number,
	): Promise<number | null> {
		const live = (
			await manager.getRepository(ShippingEntity).find({
				select: { id: true, status: true },
				where: {
					order_id: orderId,
					scope: ShippingScopeEnum.DELIVERY,
				},
			})
		).filter(
			(delivery) =>
				!UNBILLED_STATUSES.some((status) => status === delivery.status),
		);

		const delivery = live.length === 1 ? live[0] : null;

		if (
			!delivery ||
			(delivery.status !== ShippingStatusEnum.PENDING &&
				delivery.status !== ShippingStatusEnum.PREPARING)
		) {
			return null;
		}

		const orderLines = await manager.getRepository(OrderLineEntity).find({
			select: {
				id: true,
				parent_id: true,
				variant_id: true,
				product_id: true,
				quantity: true,
			},
			where: { order_id: orderId },
		});

		// A header is the line its components point at; it names what was sold and holds no stock
		const headerIds = new Set(
			orderLines.flatMap((line) =>
				line.parent_id === null ? [] : [line.parent_id],
			),
		);
		const goods = orderLines.filter((line) => !headerIds.has(line.id));

		const physical =
			goods.length === 0
				? []
				: await manager.getRepository(ProductEntity).find({
						select: { id: true },
						where: {
							id: In([
								...new Set(
									goods.map((line) => line.product_id),
								),
							]),
							type: ProductTypeEnum.PHYSICAL,
						},
					});
		const physicalIds = new Set(physical.map((product) => product.id));

		const byVariant = new Map<
			number,
			{ variant_id: number; product_id: number; quantity: number }
		>();

		for (const line of goods) {
			if (!physicalIds.has(line.product_id)) {
				continue;
			}

			const existing = byVariant.get(line.variant_id);

			if (existing) {
				existing.quantity += Number(line.quantity);
			} else {
				byVariant.set(line.variant_id, {
					variant_id: line.variant_id,
					product_id: line.product_id,
					quantity: Number(line.quantity),
				});
			}
		}

		if (byVariant.size === 0) {
			return null;
		}

		const notes = new Map(
			(
				await manager.getRepository(ShippingLineEntity).find({
					select: { variant_id: true, notes: true },
					where: { shipping_id: delivery.id },
				})
			).map((line) => [line.variant_id, line.notes]),
		);

		await this.writeLines(
			manager,
			delivery.id,
			[...byVariant.values()].map((line) => ({
				...line,
				notes: notes.get(line.variant_id) ?? undefined,
			})),
		);

		return delivery.id;
	}

	/**
	 * @description Used by `shipping.bootstrap.ts` once an order is canceled
	 *
	 * Withdraws the order's deliveries that have not left - `pending` or `preparing` - by moving
	 * them to `canceled`. One already with the carrier is the operator's to bring back, and a
	 * `return` is left alone for the reason `prepareForOrder` gives. Each goes through
	 * `updateStatus`, so it is announced like an operator's move.
	 */
	public async cancelForOrder(orderId: number): Promise<void> {
		const open = await this.repository
			.createQuery()
			.filterBy('order_id', orderId)
			.filterBy('scope', ShippingScopeEnum.DELIVERY)
			.filterBy(
				'status',
				[ShippingStatusEnum.PENDING, ShippingStatusEnum.PREPARING],
				'IN',
			)
			.all();

		for (const entry of open) {
			await this.updateStatus(entry, ShippingStatusEnum.CANCELED);
		}
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<ShippingEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used by the billable-source provider in `invoice/sources/shipping.source.ts`
	 *
	 * The movements billable at all, of one order or by id: every one except a failed or canceled
	 * movement, and only one carrying a price - a free movement has nothing to bill.
	 */
	public findBillable(filter: {
		order_id?: number;
		id?: number;
	}): Promise<ShippingEntity[]> {
		return this.repository
			.createQuery()
			.select([
				'shipping.id',
				'shipping.order_id',
				'shipping.scope',
				'shipping.status',
				'shipping.price',
				'shipping.vat_rate',
				'shipping.discount_reduction',
			])
			.filterBy('order_id', filter.order_id)
			.filterBy('id', filter.id)
			.filterBy('status', [...UNBILLED_STATUSES], 'NOT IN')
			.filterBy('price', 0, '>')
			.orderBy('id')
			.all();
	}

	/**
	 * @description Used to confirm a prepaid order (`order-settlement`) and to restate its pending
	 * payment request after an edit (`cart`)
	 *
	 * What the buyer is asked to pay for an order, gross: its goods (`OrderService.computeTotals`)
	 * plus every movement that charges for itself, the same two figures a checkout adds up into its
	 * payment request. A movement counts on the terms `findBillable` bills it on - priced, and not
	 * failed or canceled - at `(price - discount_reduction) x (1 + vat_rate)`.
	 *
	 * Read through the caller's manager, so a caller inside the transaction that rewrote the lines
	 * sees the new ones.
	 */
	public async computeOrderPayable(
		orderId: number,
		manager: EntityManager = dataSource.manager,
	): Promise<number> {
		const [lines, movements] = await Promise.all([
			manager
				.getRepository(OrderLineEntity)
				.find({ where: { order_id: orderId } }),
			manager.getRepository(ShippingEntity).find({
				select: {
					id: true,
					price: true,
					vat_rate: true,
					discount_reduction: true,
				},
				where: {
					order_id: orderId,
					status: Not(In([...UNBILLED_STATUSES])),
					price: MoreThan(0),
				},
			}),
		]);

		const charges = movements.reduce(
			(sum, movement) =>
				sum +
				roundMoney(
					(Number(movement.price) -
						Number(movement.discount_reduction)) *
						(1 + Number(movement.vat_rate) / 100),
				),
			0,
		);

		return roundMoney(
			this.orderService.computeTotals(lines).total + charges,
		);
	}

	/**
	 * @description Used by the billable-source provider in `invoice/sources/shipping.source.ts`
	 *
	 * The fee of each movement, deleted ones included: a document already billing a movement keeps
	 * its ceiling after the row goes.
	 */
	public async getPrices(
		ids: readonly number[],
	): Promise<Map<number, number>> {
		if (ids.length === 0) {
			return new Map();
		}

		const rows = await this.repository
			.createQuery()
			.select(['shipping.id', 'shipping.price'])
			.filterBy('id', [...ids], 'IN')
			.withDeleted(true)
			.all();

		return new Map(rows.map((row) => [row.id, Number(row.price)]));
	}

	/**
	 * What travels in one movement, in the order the lines were written, each with what a reader
	 * needs to recognize it - the variant's SKU and the product's name.
	 *
	 * Both are looked up in one batched read each rather than joined, so a variant or a translation
	 * removed since still names what physically moved: a join would apply `deleted_at IS NULL` and
	 * blank it. The name is in the default content language for the reason `OrderService.getLines`
	 * gives - the `read` payload is cached per id alone.
	 */
	public async getLines(
		shippingId: number,
	): Promise<ShippingLineWithLabel[]> {
		const lines = await dataSource.getRepository(ShippingLineEntity).find({
			where: { shipping_id: shippingId },
			order: { id: 'ASC' },
		});

		if (lines.length === 0) {
			return [];
		}

		const variantIds = [...new Set(lines.map((line) => line.variant_id))];
		const productIds = [...new Set(lines.map((line) => line.product_id))];

		const [variants, contents] = await Promise.all([
			dataSource.getRepository(ProductVariantEntity).find({
				select: { id: true, sku: true },
				where: { id: In(variantIds) },
				withDeleted: true,
			}),
			dataSource.getRepository(ProductContentEntity).find({
				select: { product_id: true, label: true },
				where: {
					product_id: In(productIds),
					language: Configuration.language(),
				},
				withDeleted: true,
			}),
		]);

		const skuByVariant = new Map(
			variants.map((variant) => [variant.id, variant.sku]),
		);
		const labelByProduct = new Map(
			contents.map((content) => [content.product_id, content.label]),
		);

		return lines.map((line) =>
			Object.assign(line, {
				sku: skuByVariant.get(line.variant_id) ?? null,
				label: labelByProduct.get(line.product_id) ?? null,
			}),
		);
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: {
		id: number;
		withDeleted: boolean;
	}): Promise<ShippingWithLines> {
		const entry = await this.repository
			.createQuery()
			.select([
				...ENTRY_COLUMNS,
				...ORDER_COLUMNS,
				...PICKUP_WAREHOUSE_COLUMNS,
				...DESTINATION_WAREHOUSE_COLUMNS,
				...CARRIER_COLUMNS,
			])
			.joinAndSelect('shipping.order', 'order', 'LEFT')
			.joinAndSelect(
				'shipping.pickup_warehouse',
				'pickup_warehouse',
				'LEFT',
			)
			.joinAndSelect(
				'shipping.destination_warehouse',
				'destination_warehouse',
				'LEFT',
			)
			.joinAndSelect('shipping.carrier', 'carrier', 'LEFT')
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();

		const [lines, [labeled]] = await Promise.all([
			this.getLines(entry.id),
			this.attachClientAddressLabels([entry]),
		]);

		return Object.assign(labeled, {
			lines: lines,
		});
	}

	/**
	 * Names the client-address ends of a set of movements in one line each - see
	 * `ClientAddressService.describeByIds` - one lookup for the whole set. An end frozen at dispatch
	 * is named by its snapshot instead, but labeled all the same: deciding that is the reader's.
	 */
	private async attachClientAddressLabels<T extends ShippingEntity>(
		entries: T[],
	): Promise<
		(T & {
			pickup_client_address_label: string | null;
			destination_client_address_label: string | null;
		})[]
	> {
		const labels = await this.clientAddressService.describeByIds(
			entries.flatMap((entry) =>
				[
					entry.pickup_client_address_id,
					entry.destination_client_address_id,
				].filter((id): id is number => id !== null),
			),
		);

		const labelOf = (id: number | null) =>
			id === null ? null : (labels.get(id) ?? null);

		return entries.map((entry) =>
			Object.assign(entry, {
				pickup_client_address_label: labelOf(
					entry.pickup_client_address_id,
				),
				destination_client_address_label: labelOf(
					entry.destination_client_address_id,
				),
			}),
		);
	}

	/**
	 * @description Used in `find` method from `ShippingPublicController`
	 *
	 * The movements of one of the account's orders, oldest first - the order a delivery and any
	 * return against it happened in. The order is resolved through `OrderService.findOwnById` first,
	 * so somebody else's order answers the same 404 as a missing one and no row of theirs is read.
	 *
	 * Unpaginated: an order has one delivery and rarely more than a return beside it.
	 */
	public async findForOwnOrder(
		orderId: number,
		userId: number,
	): Promise<ShippingEntity[]> {
		await this.orderService.findOwnById(orderId, userId);

		return (
			this.repository
				.createQuery()
				.select([
					...PUBLIC_ENTRY_COLUMNS,
					...PUBLIC_PICKUP_WAREHOUSE_COLUMNS,
					...CARRIER_COLUMNS,
				])
				/*
				 * `join` rather than `joinAndSelect`: the latter selects the whole joined row whatever
				 * the column list says, which would hand the buyer the warehouse's notes and address id.
				 */
				.join('shipping.pickup_warehouse', 'pickup_warehouse', 'LEFT')
				.join('shipping.carrier', 'carrier', 'LEFT')
				.filterBy('order_id', orderId)
				.orderBy('id')
				.all()
		);
	}

	/**
	 * The movements of several of the buyer's orders at once - a page of the order history, read in
	 * one query rather than one per row.
	 *
	 * Ownership is part of the query, through the order's client, so an id the caller does not own
	 * contributes no rows instead of failing the whole read: the page a buyer holds may have gone
	 * stale, and one foreign or deleted id should not blank the rest.
	 */
	public findForOwnOrders(
		orderIds: number[],
		userId: number,
	): Promise<ShippingEntity[]> {
		return (
			this.repository
				.createQuery()
				.select([
					...PUBLIC_ENTRY_COLUMNS,
					...PUBLIC_PICKUP_WAREHOUSE_COLUMNS,
					...CARRIER_COLUMNS,
				])
				// `join` for the reason `findForOwnOrder` gives
				.join('shipping.pickup_warehouse', 'pickup_warehouse', 'LEFT')
				.join('shipping.carrier', 'carrier', 'LEFT')
				.join('shipping.order', 'order', 'INNER')
				.join('order.client', 'client', 'INNER')
				.filterBy('order_id', orderIds, 'IN')
				.filterBy('client.user_id', userId)
				.orderBy('id')
				.all()
		);
	}

	public async findByFilter(
		data: ValidatorOutput<ShippingValidator, 'find'>,
		withDeleted: boolean,
	) {
		const query = this.repository
			.createQuery()
			.select([
				...ENTRY_COLUMNS,
				...ORDER_COLUMNS,
				...PICKUP_WAREHOUSE_COLUMNS,
				...DESTINATION_WAREHOUSE_COLUMNS,
				...CARRIER_COLUMNS,
			])
			.joinAndSelect('shipping.order', 'order', 'LEFT')
			.joinAndSelect(
				'shipping.pickup_warehouse',
				'pickup_warehouse',
				'LEFT',
			)
			.joinAndSelect(
				'shipping.destination_warehouse',
				'destination_warehouse',
				'LEFT',
			)
			.joinAndSelect('shipping.carrier', 'carrier', 'LEFT')
			.filterById(data.filter.id)
			.filterBy('scope', data.filter.scope)
			.filterBy('document_ref', data.filter.document_ref)
			.filterBy('pickup_warehouse_id', data.filter.pickup_warehouse_id)
			.filterBy(
				'destination_warehouse_id',
				data.filter.destination_warehouse_id,
			)
			.filterBy('carrier_id', data.filter.carrier_id)
			.filterBy('status', data.filter.status)
			.filterBy('method', data.filter.method)
			.filterByRange(
				'shipped_at',
				data.filter.shipped_at_start,
				data.filter.shipped_at_end,
			)
			.filterByTerm(data.filter.term);

		// One order or several - `IN` either way, since the filter always arrives as a list
		if (data.filter.order_id) {
			query.filterBy('order_id', data.filter.order_id, 'IN');
		}

		const [entries, total] = await query
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);

		return [await this.attachClientAddressLabels(entries), total] as const;
	}
}

export const shippingService = new ShippingService(
	getShippingRepository(),
	shippingRateService,
	orderService,
	warehouseService,
	carrierService,
	clientAddressService,
	addressService,
);
