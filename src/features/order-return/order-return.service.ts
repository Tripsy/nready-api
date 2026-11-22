import { type EntityManager, In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { CustomError, NotFoundError } from '@/exceptions';
import ClientEntity from '@/features/client/client.entity';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import {
	type DocumentSeriesService,
	documentSeriesService,
} from '@/features/document-series/document-series.service';
import InvoiceEntity, {
	InvoiceStatusEnum,
} from '@/features/invoice/invoice.entity';
import {
	type InvoiceService,
	invoiceService,
} from '@/features/invoice/invoice.service';
import { InvoiceLineKindEnum } from '@/features/invoice/invoice-line.entity';
import InvoiceSourceEntity, {
	InvoiceSourceTypeEnum,
} from '@/features/invoice/invoice-source.entity';
import OrderEntity, { OrderStatusEnum } from '@/features/order/order.entity';
import {
	type OrderService,
	orderService,
} from '@/features/order/order.service';
import OrderLineEntity from '@/features/order/order-line.entity';
import OrderReturnEntity, {
	LIVE_STATUSES,
	type MANUAL_STATUSES,
	type OrderReturnStatus,
	OrderReturnStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/order-return/order-return.entity';
import { getOrderReturnRepository } from '@/features/order-return/order-return.repository';
import type { OrderReturnValidator } from '@/features/order-return/order-return.validator';
import {
	type OrderReturnEmailEvent,
	OrderReturnEmailEventEnum,
	type OrderReturnEmailService,
	type OrderReturnRecipient,
	orderReturnEmailService,
} from '@/features/order-return/order-return-email.service';
import OrderReturnLineEntity from '@/features/order-return/order-return-line.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ShippingEntity, {
	ShippingMethodEnum,
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import { notifyShippingChanged } from '@/features/shipping/shipping.hooks';
import {
	type ShippingService,
	shippingService,
} from '@/features/shipping/shipping.service';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import { runInBackground } from '@/helpers/background.helper';
import { compareIds } from '@/helpers/id.helper';
import { roundMoney } from '@/helpers/shop.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

const ENTRY_COLUMNS = [
	'order_return.id',
	'order_return.ref_code',
	'order_return.ref_number',
	'order_return.status',
	'order_return.reason',
	'order_return.customer_notes',
	'order_return.response',
	'order_return.notes',
	'order_return.decided_at',
	'order_return.received_at',
	'order_return.closed_at',
	'order_return.reversal_invoice_ids',
	'order_return.refund_shipping',
	'order_return.order_id',
	'order_return.shipping_id',
	'order_return.user_id',
	'order_return.created_at',
	'order_return.updated_at',
	'order_return.deleted_at',
];

/** What the buyer is shown: no internal notes, no account or reversal ids. */
const PUBLIC_ENTRY_COLUMNS = [
	'order_return.id',
	'order_return.ref_code',
	'order_return.ref_number',
	'order_return.status',
	'order_return.reason',
	'order_return.customer_notes',
	'order_return.response',
	'order_return.decided_at',
	'order_return.received_at',
	'order_return.closed_at',
	'order_return.refund_shipping',
	'order_return.order_id',
	'order_return.created_at',
	'order_return.updated_at',
];

const ORDER_COLUMNS = [
	'order.id',
	'order.ref_code',
	'order.ref_number',
	'order.client_id',
];

const SHIPPING_COLUMNS = [
	'shipping.id',
	'shipping.status',
	'shipping.destination_warehouse_id',
	'shipping.tracking_number',
	'shipping.tracking_url',
	'shipping.shipped_at',
	'shipping.delivered_at',
];

/** A return still waiting on a decision; only these claim delivered goods through their lines. */
const AWAITING_MOVEMENT: readonly OrderReturnStatus[] = [
	OrderReturnStatusEnum.REQUESTED,
];

/** A return whose movement, if any, can still be withdrawn - nothing has left the client. */
const MOVEMENT_WITHDRAWABLE = [
	ShippingStatusEnum.PENDING,
	ShippingStatusEnum.PREPARING,
] as const;

/** An order whose goods may be sent back: accepted, so its deliveries can have arrived. */
const RETURNABLE_ORDER_STATUSES = [
	OrderStatusEnum.CONFIRMED,
	OrderStatusEnum.COMPLETED,
] as const;

type ReturnLinePayload = ValidatorOutput<
	OrderReturnValidator,
	'create'
>['lines'];

/** A line with the variant's SKU and the product's name; either is null when unresolved. */
export type OrderReturnLineWithLabel = OrderReturnLineEntity & {
	sku: string | null;
	label: string | null;
};

export type OrderReturnWithLines = Omit<OrderReturnEntity, 'lines'> & {
	lines: OrderReturnLineWithLabel[];
};

/** One variant of an order as the return form is drawn from. */
export type ReturnableLine = {
	variant_id: EntityId;
	product_id: EntityId;
	sku: string | null;
	label: string | null;
	returnable: number;
};

export type ReturnableSummary = {
	/** The last day the buyer may ask - null when nothing has been delivered yet. */
	deadline: Date | null;
	lines: ReturnableLine[];
};

/**
 * Return authorizations: a buyer (or an operator for them) asks to send delivered goods back, an
 * operator decides, and the existing documents do the moving.
 *
 * - **Request** - capped per variant by what the order's `delivered` deliveries carried, less what
 *   live returns already claim: an approved return through its movement's lines (the shipping
 *   cap), a pending one through its own. Raised under a lock on the order, so two requests cannot
 *   claim the same units.
 * - **Approve** - writes the `return` movement in the same transaction, lines copied from the
 *   request. From then on the movement is the truth about what travels.
 * - **Received** - the movement arrived (`notifyReturnReceived`): stock is already in, by each
 *   line's condition (`warehouse-movement`). The return moves on and drafts the refund -
 *   quantity reversals of the order's issued invoices, from what the movement actually carried.
 *   An operator issues them; issuing is what pays the money back.
 */
export class OrderReturnService {
	constructor(
		private repository: ReturnType<typeof getOrderReturnRepository>,
		private documentSeriesService: DocumentSeriesService,
		private orderService: OrderService,
		private shippingService: ShippingService,
		private invoiceService: InvoiceService,
		private emailService: OrderReturnEmailService,
	) {}

	public findById(
		id: EntityId,
		withDeleted: boolean,
	): Promise<OrderReturnEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * Per variant, what of the order can still be asked back: delivered and not yet claimed. The
	 * shipping side answers for movements (`getReturnableByVariant`), and requests still waiting on a
	 * decision are taken off here, since they have no movement yet.
	 */
	private async computeReturnable(
		manager: EntityManager,
		orderId: EntityId,
		excludeReturnId?: EntityId,
	): Promise<Map<EntityId, number>> {
		const returnable = await this.shippingService.getReturnableByVariant(
			orderId,
			manager,
		);

		const pending = manager
			.getRepository(OrderReturnLineEntity)
			.createQueryBuilder('line')
			.innerJoin(
				OrderReturnEntity,
				'order_return',
				'order_return.id = line.order_return_id AND order_return.deleted_at IS NULL',
			)
			.where('order_return.order_id = :orderId', { orderId: orderId })
			.andWhere('order_return.status IN (:...statuses)', {
				statuses: AWAITING_MOVEMENT,
			})
			.andWhere('line.deleted_at IS NULL');

		if (excludeReturnId) {
			pending.andWhere('order_return.id != :excludeReturnId', {
				excludeReturnId: excludeReturnId,
			});
		}

		const claimed = await pending
			.select('line.variant_id', 'variant_id')
			.addSelect('SUM(line.quantity)', 'quantity')
			.groupBy('line.variant_id')
			.getRawMany<{ variant_id: EntityId; quantity: string }>();

		for (const row of claimed) {
			const variantId = row.variant_id;
			const left = roundMoney(
				(returnable.get(variantId) ?? 0) - Number(row.quantity),
			);

			if (left > 0) {
				returnable.set(variantId, left);
			} else {
				returnable.delete(variantId);
			}
		}

		return returnable;
	}

	/**
	 * The last day a buyer may ask: the order's most recent delivery arriving, plus the window.
	 * Null while nothing has arrived.
	 */
	private async resolveDeadline(
		manager: EntityManager,
		orderId: EntityId,
	): Promise<Date | null> {
		const row = await manager
			.getRepository(ShippingEntity)
			.createQueryBuilder('shipping')
			.select('MAX(shipping.delivered_at)', 'delivered_at')
			.where('shipping.order_id = :orderId', { orderId: orderId })
			.andWhere('shipping.scope = :scope', {
				scope: ShippingScopeEnum.DELIVERY,
			})
			.andWhere('shipping.status = :status', {
				status: ShippingStatusEnum.DELIVERED,
			})
			.getRawOne<{ delivered_at: Date | null }>();

		if (!row?.delivered_at) {
			return null;
		}

		const deadline = new Date(row.delivered_at);

		deadline.setDate(
			deadline.getDate() + Configuration.get('orderReturn.windowDays'),
		);

		return deadline;
	}

	/** Every variant the order sold, with the product it belongs to - the pair a line is keyed on. */
	private async orderVariants(
		manager: EntityManager,
		orderId: EntityId,
	): Promise<Map<EntityId, EntityId>> {
		const lines = await manager.getRepository(OrderLineEntity).find({
			select: { variant_id: true, product_id: true },
			where: { order_id: orderId },
		});

		return new Map(lines.map((line) => [line.variant_id, line.product_id]));
	}

	/**
	 * @description Used by `returnable` in both controllers
	 *
	 * What the return form offers: one entry per variant with something left to send back.
	 */
	public async getReturnable(orderId: EntityId): Promise<ReturnableSummary> {
		const manager = dataSource.manager;

		const [returnable, variants, deadline] = await Promise.all([
			this.computeReturnable(manager, orderId),
			this.orderVariants(manager, orderId),
			this.resolveDeadline(manager, orderId),
		]);

		const labels = await this.resolveLabels([...returnable.keys()]);

		return {
			deadline: deadline,
			// Every returnable variant was sold on the order, so the lookup always finds it
			lines: [...returnable.entries()].flatMap(
				([variantId, quantity]) => {
					const productId = variants.get(variantId);

					return productId === undefined
						? []
						: [
								{
									variant_id: variantId,
									product_id: productId,
									sku: labels.get(variantId)?.sku ?? null,
									label: labels.get(variantId)?.label ?? null,
									returnable: quantity,
								},
							];
				},
			),
		};
	}

	/**
	 * Proves every requested line can be asked back - on the order, and within what is left - and
	 * returns the lines with the product each variant was sold under.
	 */
	private async resolveLines(
		manager: EntityManager,
		orderId: EntityId,
		lines: ReturnLinePayload,
		excludeReturnId?: EntityId,
	): Promise<
		{ variant_id: EntityId; product_id: EntityId; quantity: number }[]
	> {
		const [returnable, variants] = await Promise.all([
			this.computeReturnable(manager, orderId, excludeReturnId),
			this.orderVariants(manager, orderId),
		]);

		return lines.map((line) => {
			const productId = variants.get(line.variant_id);

			// 422: a line the form should not have offered, and drops
			if (productId === undefined) {
				throw new CustomError(
					422,
					lang('order-return.error.invalid_line', {
						variant_id: String(line.variant_id),
					}),
				);
			}

			const remaining = returnable.get(line.variant_id) ?? 0;

			if (line.quantity > remaining) {
				throw new CustomError(
					409,
					lang('order-return.error.over_returnable', {
						variant_id: String(line.variant_id),
						remaining: String(remaining),
					}),
				);
			}

			return {
				variant_id: line.variant_id,
				product_id: productId,
				quantity: line.quantity,
			};
		});
	}

	/** Locks the order for the rest of the caller's transaction, so its returns are judged one at a time. */
	private async lockOrder(
		manager: EntityManager,
		orderId: EntityId,
	): Promise<OrderEntity> {
		const order = await manager.getRepository(OrderEntity).findOne({
			select: { id: true, status: true },
			where: { id: orderId },
			lock: { mode: 'pessimistic_write' },
		});

		if (!order) {
			throw new NotFoundError(lang('order.error.not_found'));
		}

		return order;
	}

	/**
	 * @description Used in `create` (back office) and `publicCreate` (storefront)
	 *
	 * A new return starts `requested` and moves nothing. The order must be accepted - goods can only
	 * have arrived on a confirmed or completed one - and every line within what is left to send
	 * back. The storefront also holds the buyer to the window after the last delivery; the back
	 * office is not, an operator making an exception is the point of raising it there.
	 *
	 * The number is allocated in the same transaction, so a request that fails to write gives its
	 * number back with it.
	 */
	public async create(
		data: ValidatorOutput<OrderReturnValidator, 'create'>,
		options: { userId: EntityId | null; enforceWindow: boolean },
	): Promise<OrderReturnEntity> {
		return dataSource.transaction(async (manager) => {
			const order = await this.lockOrder(manager, data.order_id);

			if (
				!RETURNABLE_ORDER_STATUSES.some(
					(status) => status === order.status,
				)
			) {
				throw new CustomError(
					409,
					lang('order-return.error.order_not_returnable'),
				);
			}

			if (options.enforceWindow) {
				const deadline = await this.resolveDeadline(
					manager,
					data.order_id,
				);

				if (deadline && deadline.getTime() < Date.now()) {
					throw new CustomError(
						409,
						lang('order-return.error.window_closed', {
							days: String(
								Configuration.get('orderReturn.windowDays'),
							),
						}),
					);
				}
			}

			const lines = await this.resolveLines(
				manager,
				data.order_id,
				data.lines,
			);

			const reference = await this.documentSeriesService.allocate(
				manager,
				DocumentTypeEnum.ORDER_RETURN,
			);

			const entry = await manager.save(
				manager.create(OrderReturnEntity, {
					ref_code: reference.code,
					ref_number: reference.number,
					status: OrderReturnStatusEnum.REQUESTED,
					reason: data.reason,
					customer_notes: data.customer_notes || null,
					response: null,
					notes: data.notes || null,
					reversal_invoice_ids: [],
					order_id: data.order_id,
					shipping_id: null,
					user_id: options.userId,
				}),
			);

			await this.writeLines(manager, entry.id, lines);

			return entry;
		});
	}

	/** Replaces a return's lines; removed outright, as `shipping_line` is - they are a statement, not a record. */
	private async writeLines(
		manager: EntityManager,
		orderReturnId: EntityId,
		lines: readonly {
			variant_id: EntityId;
			product_id: EntityId;
			quantity: number;
		}[],
	): Promise<void> {
		await manager
			.getRepository(OrderReturnLineEntity)
			.delete({ order_return_id: orderReturnId });

		await manager.save(
			lines.map((line) =>
				manager.create(OrderReturnLineEntity, {
					order_return_id: orderReturnId,
					variant_id: line.variant_id,
					product_id: line.product_id,
					quantity: line.quantity,
				}),
			),
		);
	}

	/** Locks the return and refuses it when it has moved on since the caller read it. */
	private async lockEntry(
		manager: EntityManager,
		entry: OrderReturnEntity,
	): Promise<OrderReturnEntity> {
		const current = await manager.getRepository(OrderReturnEntity).findOne({
			where: { id: entry.id },
			lock: { mode: 'pessimistic_write' },
		});

		if (!current) {
			throw new NotFoundError(lang('order-return.error.not_found'));
		}

		if (current.status !== entry.status) {
			throw new CustomError(
				409,
				lang('order-return.error.status_changed'),
			);
		}

		return current;
	}

	/**
	 * Whether the refund is still ahead: the return is live (not rejected or canceled) and nothing
	 * has been drafted. `refund_shipping` is read by the draft, so it changes only while this holds.
	 */
	private isRefundOpen(entry: OrderReturnEntity): boolean {
		return (
			LIVE_STATUSES.some((status) => status === entry.status) &&
			entry.reversal_invoice_ids.length === 0
		);
	}

	/**
	 * @description Used in `update` method from controller
	 *
	 * While `requested` everything may change, the lines re-checked against what is left (this
	 * return's own claim left out). Once decided, only the text around it: what travels is the
	 * movement's from then on, and the reason is part of what was decided on. `refund_shipping`
	 * follows the refund instead - open until it is drafted.
	 */
	public async updateData(
		entry: OrderReturnEntity,
		data: ValidatorOutput<OrderReturnValidator, 'update'>,
	): Promise<OrderReturnEntity> {
		const isRequested = entry.status === OrderReturnStatusEnum.REQUESTED;

		if (!isRequested && (data.lines || data.reason)) {
			throw new CustomError(
				409,
				lang('order-return.error.decided_locked'),
			);
		}

		const saved = await dataSource.transaction(async (manager) => {
			const current = await this.lockEntry(manager, entry);

			if (
				data.refund_shipping !== undefined &&
				data.refund_shipping !== current.refund_shipping &&
				!this.isRefundOpen(current)
			) {
				throw new CustomError(
					409,
					lang('order-return.error.refund_shipping_locked'),
				);
			}

			if (data.lines) {
				await this.lockOrder(manager, current.order_id);

				const lines = await this.resolveLines(
					manager,
					current.order_id,
					data.lines,
					current.id,
				);

				await this.writeLines(manager, current.id, lines);
			}

			Object.assign(current, {
				...(data.reason !== undefined && { reason: data.reason }),
				...(data.customer_notes !== undefined && {
					customer_notes: data.customer_notes || null,
				}),
				...(data.response !== undefined && {
					response: data.response || null,
				}),
				...(data.notes !== undefined && { notes: data.notes || null }),
				...(data.refund_shipping !== undefined && {
					refund_shipping: data.refund_shipping,
				}),
			});

			return manager.save(current);
		});

		await cleanEntityCache(OrderReturnEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `approve` method from controller
	 *
	 * Writes the `return` movement and moves the request to `approved`, in one transaction - a
	 * return approved with no movement, or a movement with no approved return, is never visible.
	 *
	 * Defaults from the order's last delivery that arrived: the goods are collected from the address
	 * they went to, in the delivery's currency. The movement is free to the buyer unless `price` is
	 * stated; its operational cost comes from the rate table, as on any back-office movement. The
	 * shipping cap re-checks the lines inside the same transaction.
	 *
	 * **The goods go back to the warehouse they left from** (`resolveDestination`): a lot belongs to
	 * the warehouse of its receipt, so a stocked unit received anywhere else has no lot to re-enter,
	 * and receiving the movement would be refused once it is already on its way - with its ends
	 * locked. Judged here, while the destination can still be chosen.
	 */
	public async approve(
		entry: OrderReturnEntity,
		data: ValidatorOutput<OrderReturnValidator, 'approve'>,
	): Promise<OrderReturnEntity> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			OrderReturnStatusEnum.APPROVED,
		);

		const [lines, delivery] = await Promise.all([
			dataSource.getRepository(OrderReturnLineEntity).find({
				where: { order_return_id: entry.id },
				order: { id: 'ASC' },
			}),
			dataSource.getRepository(ShippingEntity).findOne({
				select: {
					id: true,
					destination_client_address_id: true,
					currency: true,
				},
				where: {
					order_id: entry.order_id,
					scope: ShippingScopeEnum.DELIVERY,
					status: ShippingStatusEnum.DELIVERED,
				},
				order: { delivered_at: 'DESC', id: 'DESC' },
			}),
		]);

		const destinationWarehouseId = await this.resolveDestination(
			entry.order_id,
			lines,
			data.destination_warehouse_id,
		);

		const input = await this.shippingService.prepareCreate({
			scope: ShippingScopeEnum.RETURN,
			method: data.method ?? ShippingMethodEnum.COURIER,
			order_id: entry.order_id,
			pickup_client_address_id:
				data.pickup_client_address_id ??
				delivery?.destination_client_address_id ??
				undefined,
			destination_warehouse_id: destinationWarehouseId,
			document_ref: undefined,
			pickup_warehouse_id: undefined,
			destination_client_address_id: undefined,
			carrier_id: data.carrier_id ?? undefined,
			tracking_number: undefined,
			tracking_url: undefined,
			price: data.price ?? 0,
			vat_rate: data.vat_rate ?? 0,
			// Left to the rate table: what a return costs the business, whoever pays the fee
			operational_cost: undefined,
			currency: delivery?.currency ?? Configuration.get('app.currency'),
			contact_name: undefined,
			contact_phone: undefined,
			contact_email: undefined,
			estimated_delivery_at: undefined,
			notes: lang('order-return.label.movement_notes', {
				reference: `${entry.ref_code}-${entry.ref_number}`,
			}),
			lines: lines.map((line) => ({
				variant_id: line.variant_id,
				product_id: line.product_id,
				quantity: Number(line.quantity),
				condition: undefined,
				notes: undefined,
			})),
		});

		const saved = await dataSource.transaction(async (manager) => {
			const current = await this.lockEntry(manager, entry);

			const movement = await this.shippingService.createWithin(
				manager,
				input,
			);

			Object.assign(current, {
				status: OrderReturnStatusEnum.APPROVED,
				shipping_id: movement.id,
				decided_at: new Date(),
				...(data.refund_shipping !== undefined && {
					refund_shipping: data.refund_shipping,
				}),
				...(data.response !== undefined && {
					response: data.response || null,
				}),
			});

			return manager.save(current);
		});

		await cleanEntityCache(OrderReturnEntity, saved.id);

		if (saved.shipping_id) {
			await notifyShippingChanged({
				shipping_id: saved.shipping_id,
				order_id: saved.order_id,
			});
		}

		this.notifyBuyer(saved.id, OrderReturnEmailEventEnum.APPROVED);

		return saved;
	}

	/**
	 * Where a return goes: the stated warehouse, or the one the order's delivered goods left from -
	 * the site that sent most of what is coming back, when several did.
	 *
	 * A stated warehouse has to have sent every stock-tracked line, at least as much as comes back
	 * (409 otherwise). Untracked goods have no lot to re-enter, so they may come back anywhere.
	 */
	private async resolveDestination(
		orderId: EntityId,
		lines: readonly OrderReturnLineEntity[],
		stated: EntityId | undefined,
	): Promise<EntityId> {
		const rows = await dataSource
			.getRepository(ShippingLineEntity)
			.createQueryBuilder('line')
			.innerJoin(
				ShippingEntity,
				'shipping',
				'shipping.id = line.shipping_id AND shipping.deleted_at IS NULL',
			)
			.where('shipping.order_id = :orderId', { orderId: orderId })
			.andWhere('shipping.scope = :scope', {
				scope: ShippingScopeEnum.DELIVERY,
			})
			.andWhere('shipping.status = :status', {
				status: ShippingStatusEnum.DELIVERED,
			})
			.select('shipping.pickup_warehouse_id', 'warehouse_id')
			.addSelect('line.variant_id', 'variant_id')
			.addSelect('SUM(line.quantity)', 'quantity')
			.groupBy('shipping.pickup_warehouse_id')
			.addGroupBy('line.variant_id')
			.getRawMany<{
				warehouse_id: EntityId;
				variant_id: EntityId;
				quantity: string;
			}>();

		const sent = new Map<string, number>();
		const sentBySite = new Map<EntityId, number>();
		const wanted = new Map(
			lines.map((line) => [line.variant_id, Number(line.quantity)]),
		);

		for (const row of rows) {
			const warehouseId = row.warehouse_id;
			const variantId = row.variant_id;
			const quantity = Number(row.quantity);

			sent.set(`${warehouseId}:${variantId}`, quantity);

			if (wanted.has(variantId)) {
				sentBySite.set(
					warehouseId,
					(sentBySite.get(warehouseId) ?? 0) +
						Math.min(quantity, wanted.get(variantId) ?? 0),
				);
			}
		}

		const destination =
			stated ??
			[...sentBySite.entries()].sort(
				(a, b) => b[1] - a[1] || compareIds(a[0], b[0]),
			)[0]?.[0];

		if (!destination) {
			throw new CustomError(
				409,
				lang('order-return.error.destination_required'),
			);
		}

		const tracked = new Set(
			(
				await dataSource.getRepository(ProductVariantEntity).find({
					select: { id: true },
					where: { id: In([...wanted.keys()]), track_stock: true },
					withDeleted: true,
				})
			).map((variant) => variant.id),
		);

		for (const [variantId, quantity] of wanted) {
			if (
				tracked.has(variantId) &&
				(sent.get(`${destination}:${variantId}`) ?? 0) < quantity
			) {
				throw new CustomError(
					409,
					lang('order-return.error.wrong_warehouse', {
						variant_id: String(variantId),
						warehouse_id: String(destination),
					}),
				);
			}
		}

		return destination;
	}

	/**
	 * @description Used in `statusUpdate` (back office) and `publicCancel` (storefront)
	 *
	 * The moves the status route takes: reject, cancel, close. Canceling an approved return
	 * withdraws its movement first, through `ShippingService.updateStatus` like any operator move -
	 * refused once the goods are on their way back (409), since the movement then decides what
	 * happened to them. A movement that already failed or bounced is left as it is.
	 */
	public async updateStatus(
		entry: OrderReturnEntity,
		newStatus: (typeof MANUAL_STATUSES)[number],
		response?: string,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		if (newStatus === OrderReturnStatusEnum.CANCELED && entry.shipping_id) {
			const movement = await this.shippingService.findById(
				entry.shipping_id,
				true,
			);

			if (movement.status === ShippingStatusEnum.SHIPPED) {
				throw new CustomError(
					409,
					lang('order-return.error.return_in_transit'),
				);
			}

			if (
				MOVEMENT_WITHDRAWABLE.some(
					(status) => status === movement.status,
				)
			) {
				await this.shippingService.updateStatus(
					movement,
					ShippingStatusEnum.CANCELED,
				);
			}
		}

		await dataSource.transaction(async (manager) => {
			const current = await this.lockEntry(manager, entry);

			Object.assign(current, {
				status: newStatus,
				...(newStatus === OrderReturnStatusEnum.REJECTED && {
					decided_at: new Date(),
				}),
				...(newStatus === OrderReturnStatusEnum.CLOSED && {
					closed_at: new Date(),
				}),
				...(response !== undefined && { response: response || null }),
			});

			await manager.save(current);
		});

		await cleanEntityCache(OrderReturnEntity, entry.id);

		if (newStatus === OrderReturnStatusEnum.REJECTED) {
			this.notifyBuyer(entry.id, OrderReturnEmailEventEnum.REJECTED);
		}
	}

	/**
	 * @description Used by `order-return.bootstrap.ts`, after a `return` movement reached its
	 * warehouse
	 *
	 * Moves the return that movement carries from `approved` to `received`, then drafts its refund.
	 * A movement raised by hand, with no return behind it, is ignored - it moved stock, and that is
	 * all it was asked to do. The status move is judged under the row lock, so a repeated
	 * announcement drafts nothing twice.
	 */
	public async receiveForMovement(shippingId: EntityId): Promise<void> {
		const entry = await this.repository
			.createQuery()
			.filterBy('shipping_id', shippingId)
			.first();

		if (!entry || entry.status !== OrderReturnStatusEnum.APPROVED) {
			return;
		}

		await dataSource.transaction(async (manager) => {
			const current = await this.lockEntry(manager, entry);

			Object.assign(current, {
				status: OrderReturnStatusEnum.RECEIVED,
				received_at: new Date(),
			});

			await manager.save(current);
		});

		await cleanEntityCache(OrderReturnEntity, entry.id);

		this.notifyBuyer(entry.id, OrderReturnEmailEventEnum.RECEIVED);

		await this.draftRefund(entry.id);
	}

	/**
	 * @description Used by `receiveForMovement`, and by the `refund` action when an operator raises
	 * it again - after the automatic draft failed, or once a document was issued late
	 *
	 * Drafts quantity reversals of the order's issued invoices for what the return movement
	 * actually carried - the warehouse may have corrected the request on arrival. Per variant, the
	 * quantity is spread over the invoice lines that billed it, oldest document first, each taken
	 * only as far as earlier reversals left it. With `refund_shipping`, the outbound delivery fee
	 * is drafted back too (`draftDeliveryFeeReversals`). One draft per document touched; none is
	 * issued here.
	 *
	 * Returns the draft ids, empty when nothing was billed to take back - a document still in draft
	 * is not reversible, and the operator corrects it instead. Refused once drafts exist, so the
	 * same goods are not taken back twice through this path; the reversal caps hold regardless.
	 */
	public async draftRefund(id: EntityId): Promise<EntityId[]> {
		const entry = await this.findById(id, false);

		if (
			entry.status !== OrderReturnStatusEnum.RECEIVED &&
			entry.status !== OrderReturnStatusEnum.CLOSED
		) {
			throw new CustomError(
				409,
				lang('order-return.error.refund_not_received'),
			);
		}

		if (entry.reversal_invoice_ids.length > 0) {
			throw new CustomError(
				409,
				lang('order-return.error.refund_already_raised'),
			);
		}

		const reference = `${entry.ref_code}-${entry.ref_number}`;

		const raised = [
			...(await this.draftGoodsReversals(entry, reference)),
			...(entry.refund_shipping
				? await this.draftDeliveryFeeReversals(entry, reference)
				: []),
		];

		if (raised.length > 0) {
			await this.repository.update(entry.id, {
				reversal_invoice_ids: raised,
			});

			await cleanEntityCache(OrderReturnEntity, entry.id);
		}

		return raised;
	}

	/** The issued originals among the given documents, oldest first - the only ones reversible. */
	private async issuedOriginals(
		invoiceIds: readonly EntityId[],
	): Promise<{ id: EntityId }[]> {
		if (invoiceIds.length === 0) {
			return [];
		}

		return dataSource.getRepository(InvoiceEntity).find({
			select: { id: true },
			where: {
				id: In([...invoiceIds]),
				is_reversal: false,
				status: InvoiceStatusEnum.ISSUED,
			},
			order: { id: 'ASC' },
		});
	}

	/**
	 * Quantity reversals of the order's issued `order` documents for what came back, per variant
	 * spread over the lines that billed it, oldest document first.
	 */
	private async draftGoodsReversals(
		entry: OrderReturnEntity,
		reference: string,
	): Promise<EntityId[]> {
		const owed = await this.returnedByVariant(entry);

		const documents = await this.issuedOriginals(
			await this.invoiceService.findIdsBySource(
				InvoiceSourceTypeEnum.ORDER,
				entry.order_id,
			),
		);

		const variantByOrderLine = new Map(
			(
				await dataSource.getRepository(OrderLineEntity).find({
					select: { id: true, variant_id: true },
					where: { order_id: entry.order_id },
				})
			).map((line) => [line.id, line.variant_id]),
		);

		const raised: EntityId[] = [];

		for (const document of documents) {
			const [lines, reversed] = await Promise.all([
				this.invoiceService.getLines(document.id),
				this.invoiceService.getReversedPerLine(document.id),
			]);

			const selection: {
				invoice_line_id: EntityId;
				quantity: number;
				amount: undefined;
			}[] = [];

			for (const line of lines) {
				const variantId =
					line.order_line_id === null
						? undefined
						: variantByOrderLine.get(line.order_line_id);
				const need = variantId ? (owed.get(variantId) ?? 0) : 0;

				if (!variantId || need <= 0) {
					continue;
				}

				const left = roundMoney(
					Number(line.quantity) -
						(reversed.get(line.id)?.quantity ?? 0),
				);
				const take = Math.min(need, left);

				if (take <= 0) {
					continue;
				}

				selection.push({
					invoice_line_id: line.id,
					quantity: take,
					amount: undefined,
				});
				owed.set(variantId, roundMoney(need - take));
			}

			if (selection.length === 0) {
				continue;
			}

			const parent = await this.invoiceService.findById(
				document.id,
				false,
			);

			const reversal = await this.invoiceService.createReversal(parent, {
				id: document.id,
				lines: selection,
				notes: lang('order-return.label.reversal_notes', {
					reference: reference,
				}),
			});

			raised.push(reversal.id);
		}

		return raised;
	}

	/**
	 * The outbound fee paid back: one reversal per issued `shipping` document of the order's
	 * deliveries, taking each `shipping` line's remaining net back **by value**.
	 *
	 * By value because the delivery did happen. A quantity reversal releases its movement as a
	 * billing source (`getBilledSourceIds`), and the next change announced on that movement would
	 * bill the fee again; a value reversal pays the money back and leaves the movement billed. The
	 * per-line net cap makes a second return asking for the same fee find nothing left.
	 */
	private async draftDeliveryFeeReversals(
		entry: OrderReturnEntity,
		reference: string,
	): Promise<EntityId[]> {
		const deliveries = await dataSource.getRepository(ShippingEntity).find({
			select: { id: true },
			where: {
				order_id: entry.order_id,
				scope: ShippingScopeEnum.DELIVERY,
			},
			withDeleted: true,
		});

		const sources =
			deliveries.length === 0
				? []
				: await dataSource.getRepository(InvoiceSourceEntity).find({
						select: { invoice_id: true },
						where: {
							source_type: InvoiceSourceTypeEnum.SHIPPING,
							source_id: In(
								deliveries.map((delivery) => delivery.id),
							),
						},
					});

		const documents = await this.issuedOriginals(
			sources.map((source) => source.invoice_id),
		);

		const raised: EntityId[] = [];

		for (const document of documents) {
			const [lines, reversed] = await Promise.all([
				this.invoiceService.getLines(document.id),
				this.invoiceService.getReversedPerLine(document.id),
			]);

			const selection = lines
				.filter((line) => line.kind === InvoiceLineKindEnum.SHIPPING)
				.map((line) => ({
					invoice_line_id: line.id,
					quantity: undefined,
					amount: roundMoney(
						Number(line.line_net) -
							(reversed.get(line.id)?.net ?? 0),
					),
				}))
				.filter((line) => line.amount > 0);

			if (selection.length === 0) {
				continue;
			}

			const parent = await this.invoiceService.findById(
				document.id,
				false,
			);

			const reversal = await this.invoiceService.createReversal(parent, {
				id: document.id,
				lines: selection,
				notes: lang('order-return.label.fee_reversal_notes', {
					reference: reference,
				}),
			});

			raised.push(reversal.id);
		}

		return raised;
	}

	/** What came back, per variant: the movement's lines, or the request when it has none. */
	private async returnedByVariant(
		entry: OrderReturnEntity,
	): Promise<Map<EntityId, number>> {
		const rows: { variant_id: EntityId; quantity: number }[] =
			entry.shipping_id
				? await dataSource.getRepository(ShippingLineEntity).find({
						select: { variant_id: true, quantity: true },
						where: { shipping_id: entry.shipping_id },
					})
				: await dataSource.getRepository(OrderReturnLineEntity).find({
						select: { variant_id: true, quantity: true },
						where: { order_return_id: entry.id },
					});

		const totals = new Map<EntityId, number>();

		for (const row of rows) {
			totals.set(
				row.variant_id,
				roundMoney(
					(totals.get(row.variant_id) ?? 0) + Number(row.quantity),
				),
			);
		}

		return totals;
	}

	/**
	 * Soft delete, only for a return that moved nothing: still requested, rejected or canceled. One
	 * that was approved holds a movement, and possibly stock and refunds, that point back at it.
	 */
	public async delete(id: EntityId): Promise<void> {
		const entry = await this.findById(id, false);

		if (
			entry.status === OrderReturnStatusEnum.APPROVED ||
			entry.status === OrderReturnStatusEnum.RECEIVED ||
			entry.status === OrderReturnStatusEnum.CLOSED
		) {
			throw new CustomError(
				409,
				lang('order-return.error.delete_locked'),
			);
		}

		await this.repository.createQuery().filterById(id).delete();
	}

	/**
	 * A restored request claims its lines again, so it is refused when the order no longer has
	 * them to give - another return took them meanwhile.
	 */
	public async restore(id: EntityId): Promise<void> {
		const entry = await this.findById(id, true);

		if (
			entry.deleted_at &&
			LIVE_STATUSES.some((status) => status === entry.status)
		) {
			const lines = await dataSource
				.getRepository(OrderReturnLineEntity)
				.find({ where: { order_return_id: entry.id } });

			await dataSource.transaction(async (manager) => {
				await this.lockOrder(manager, entry.order_id);
				await this.resolveLines(
					manager,
					entry.order_id,
					lines,
					entry.id,
				);
			});
		}

		await this.repository.createQuery().filterById(id).restore();
	}

	/**
	 * Emails the buyer after a decision or an arrival has committed. In the background: the email
	 * is a courtesy on top of a change already made, and a template or queue failure must not turn
	 * a committed approval into an error response. Failures are logged.
	 */
	private notifyBuyer(id: EntityId, event: OrderReturnEmailEvent): void {
		runInBackground(
			this.sendBuyerEmail(id, event),
			`order-return.email.${event} #${id}`,
		);
	}

	private async sendBuyerEmail(
		id: EntityId,
		event: OrderReturnEmailEvent,
	): Promise<void> {
		const entry = await this.getEntryData({ id: id, withDeleted: false });
		const recipient = await this.resolveRecipient(entry.order?.client_id);

		if (!recipient) {
			return;
		}

		await this.emailService.send(event, entry, recipient);
	}

	/**
	 * Who hears about the order's returns: the account the client belongs to - the one a
	 * storefront request is made from - in its own language, else the client's contact email in
	 * the default one. Null when the client has neither; a back-office client may have no email.
	 */
	private async resolveRecipient(
		clientId: EntityId | undefined,
	): Promise<OrderReturnRecipient | null> {
		if (!clientId) {
			return null;
		}

		const client = await dataSource.getRepository(ClientEntity).findOne({
			select: {
				id: true,
				company_name: true,
				person_name: true,
				contact_name: true,
				contact_email: true,
				user: { id: true, name: true, email: true, language: true },
			},
			relations: { user: true },
			where: { id: clientId },
		});

		if (client?.user) {
			return {
				name: client.user.name,
				address: client.user.email,
				language: client.user.language,
			};
		}

		if (client?.contact_email) {
			return {
				name:
					client.contact_name ??
					client.person_name ??
					client.company_name ??
					'',
				address: client.contact_email,
				language: Configuration.language(),
			};
		}

		return null;
	}

	/**
	 * The SKU and product name of each variant, looked up rather than joined so a variant or a
	 * translation removed since still names what came back. Default content language - the read
	 * payload is cached per id alone.
	 */
	private async resolveLabels(
		variantIds: readonly EntityId[],
	): Promise<Map<EntityId, { sku: string | null; label: string | null }>> {
		if (variantIds.length === 0) {
			return new Map();
		}

		const variants = await dataSource
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true, sku: true, product_id: true },
				where: { id: In([...new Set(variantIds)]) },
				withDeleted: true,
			});

		const contents =
			variants.length === 0
				? []
				: await dataSource.getRepository(ProductContentEntity).find({
						select: { product_id: true, label: true },
						where: {
							product_id: In([
								...new Set(
									variants.map(
										(variant) => variant.product_id,
									),
								),
							]),
							language: Configuration.language(),
						},
						withDeleted: true,
					});

		const labelByProduct = new Map(
			contents.map((content) => [content.product_id, content.label]),
		);

		return new Map(
			variants.map((variant) => [
				variant.id,
				{
					sku: variant.sku ?? null,
					label: labelByProduct.get(variant.product_id) ?? null,
				},
			]),
		);
	}

	/** The lines of several returns at once, labeled, keyed by return. */
	private async getLinesFor(
		orderReturnIds: readonly EntityId[],
	): Promise<Map<EntityId, OrderReturnLineWithLabel[]>> {
		if (orderReturnIds.length === 0) {
			return new Map();
		}

		const lines = await dataSource
			.getRepository(OrderReturnLineEntity)
			.find({
				where: { order_return_id: In([...orderReturnIds]) },
				order: { id: 'ASC' },
			});

		const labels = await this.resolveLabels(
			lines.map((line) => line.variant_id),
		);

		const grouped = new Map<EntityId, OrderReturnLineWithLabel[]>();

		for (const line of lines) {
			const list = grouped.get(line.order_return_id) ?? [];

			list.push(
				Object.assign(line, {
					sku: labels.get(line.variant_id)?.sku ?? null,
					label: labels.get(line.variant_id)?.label ?? null,
				}),
			);

			grouped.set(line.order_return_id, list);
		}

		return grouped;
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 *
	 * The return with its order reference, its movement's progress and its lines.
	 */
	public async getEntryData(data: {
		id: EntityId;
		withDeleted: boolean;
	}): Promise<OrderReturnWithLines> {
		const entry = await this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...ORDER_COLUMNS, ...SHIPPING_COLUMNS])
			.join('order_return.order', 'order', 'LEFT')
			.join('order_return.shipping', 'shipping', 'LEFT')
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();

		const lines = await this.getLinesFor([entry.id]);

		return Object.assign(entry, { lines: lines.get(entry.id) ?? [] });
	}

	public findByFilter(
		data: ValidatorOutput<OrderReturnValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...ORDER_COLUMNS, ...SHIPPING_COLUMNS])
			.join('order_return.order', 'order', 'LEFT')
			.join('order_return.shipping', 'shipping', 'LEFT')
			.filterById(data.filter.id)
			.filterBy('order_id', data.filter.order_id)
			.filterBy('status', data.filter.status)
			.filterBy('reason', data.filter.reason)
			.filterByRange(
				'created_at',
				data.filter.create_date_start,
				data.filter.create_date_end,
			)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}

	/**
	 * @description Used in `find` method from `OrderReturnPublicController`
	 *
	 * The caller's returns against one of their own orders, oldest first, with lines and the
	 * movement's tracking. Ownership is proven through the order (`findOwnById`, 404 otherwise).
	 */
	public async findForOwnOrder(
		orderId: EntityId,
		userId: EntityId,
	): Promise<OrderReturnWithLines[]> {
		await this.orderService.findOwnById(orderId, userId);

		const entries = await this.repository
			.createQuery()
			.select([
				...PUBLIC_ENTRY_COLUMNS,
				'shipping.id',
				'shipping.status',
				'shipping.tracking_number',
				'shipping.tracking_url',
			])
			.join('order_return.shipping', 'shipping', 'LEFT')
			.filterBy('order_id', orderId)
			.orderBy('id', 'ASC')
			.all();

		const lines = await this.getLinesFor(entries.map((entry) => entry.id));

		return entries.map((entry) =>
			Object.assign(entry, { lines: lines.get(entry.id) ?? [] }),
		);
	}

	/** @description Used in `returnable` method from `OrderReturnPublicController` */
	public async getOwnReturnable(
		orderId: EntityId,
		userId: EntityId,
	): Promise<ReturnableSummary> {
		await this.orderService.findOwnById(orderId, userId);

		return this.getReturnable(orderId);
	}

	/** @description Used in `create` method from `OrderReturnPublicController` */
	public async createOwn(
		data: ValidatorOutput<OrderReturnValidator, 'publicCreate'>,
		userId: EntityId,
	): Promise<OrderReturnEntity> {
		await this.orderService.findOwnById(data.order_id, userId);

		return this.create(
			{ ...data, notes: undefined },
			{ userId: userId, enforceWindow: true },
		);
	}

	/**
	 * @description Used in `cancel` method from `OrderReturnPublicController`
	 *
	 * A buyer may withdraw a request only while nobody has decided on it. The row is resolved by
	 * the order the caller owns *and* its id, so a foreign id answers 404 like a missing one.
	 */
	public async cancelOwn(
		orderId: EntityId,
		id: EntityId,
		userId: EntityId,
	): Promise<void> {
		await this.orderService.findOwnById(orderId, userId);

		const entry = await this.repository
			.createQuery()
			.filterById(id)
			.filterBy('order_id', orderId)
			.firstOrFail();

		if (entry.status !== OrderReturnStatusEnum.REQUESTED) {
			throw new CustomError(
				409,
				lang('order-return.error.cancel_decided'),
			);
		}

		await this.updateStatus(entry, OrderReturnStatusEnum.CANCELED);
	}
}

export const orderReturnService = new OrderReturnService(
	getOrderReturnRepository(),
	documentSeriesService,
	orderService,
	shippingService,
	invoiceService,
	orderReturnEmailService,
);
