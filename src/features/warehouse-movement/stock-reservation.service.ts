import { type EntityManager, In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import type { WarehouseAvailability } from '@/features/cart/cart.hooks';
import GrnEntity, { GrnStatusEnum } from '@/features/grn/grn.entity';
import GrnItemEntity from '@/features/grn/grn-item.entity';
import OrderEntity, { OrderStatusEnum } from '@/features/order/order.entity';
import type { StockDemand } from '@/features/order/order.hooks';
import OrderLineEntity from '@/features/order/order-line.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ShippingEntity, {
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';
import StockReservationEntity from '@/features/warehouse-movement/stock-reservation.entity';
import type { VariantAvailability } from '@/shared/registries/stock-availability.registry';

/** Stock figures for one variant. */
export type VariantStock = {
	on_hand: number; // Open lots on confirmed receipts, in active warehouses
	reserved: number; // Promised to live orders not yet shipped
	available: number; // on_hand - reserved; negative when over-committed
};

/** One warehouse's share of a variant's stock. */
export type WarehouseStock = {
	warehouse_id: number;
	code: string;
	name: string;
	status: string;
	on_hand: number;
};

/**
 * A delivery whose goods have left for good, over `shipping` joined to `shipping_line`: it has
 * shipped (`shipped_at` is stamped once and never cleared) and did not come back. That covers
 * `shipped`, `delivered` and a `failed` after shipping - lost goods are gone too - and leaves out
 * `returned`, whose goods are back on hand. Shared by the reservation backfill and the reconcile
 * report, which have to agree on it. Built from enum constants only - nothing from input reaches it.
 */
export const GONE_DELIVERY_SQL = `
	shipping.scope = '${ShippingScopeEnum.DELIVERY}'
	AND shipping.shipped_at IS NOT NULL
	AND shipping.status <> '${ShippingStatusEnum.RETURNED}'
	AND shipping.deleted_at IS NULL
	AND shipping_line.deleted_at IS NULL
`;

/** The order statuses whose reservations still stand. */
export const RESERVING_STATUSES = [
	OrderStatusEnum.PENDING,
	OrderStatusEnum.CONFIRMED,
] as const;

/** Quantities are `numeric(12,2)`; sums of them are rounded back to that scale. */
function roundQuantity(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * The virtual side of stock: what orders have promised, and what is therefore left to sell.
 *
 * **Available = on hand - reserved, per variant.** On hand is the sum of open lots on confirmed,
 * live receipts in **active** warehouses - an inactive site ships nothing, so its stock is not for
 * sale. Reserved is the sum over live orders. Neither is stored as a running total: both are sums
 * over a handful of indexed rows, and a stored figure would be one more thing to drift.
 *
 * **Serialized on the variant row.** A reservation takes `FOR NO KEY UPDATE` on each tracked
 * variant it names, in id order, before reading either figure. Two checkouts racing for the last
 * unit queue on it, and so does a goods receipt confirming or canceling (its `FOR UPDATE`
 * conflicts with it). `NO KEY` is deliberate: it does not conflict with the `KEY SHARE` lock an
 * `order_line` or `cart_item` insert takes on the variant it references, so an unrelated basket
 * write never queues behind a checkout.
 *
 * Canceling a confirmed receipt is not refused by reservations: the goods are not there, and
 * hiding that behind a refusal helps nobody. The variant shows negative availability instead.
 */
export class StockReservationService {
	/**
	 * @description Used through `order.hooks.ts` by `orderService.create` and `updateData`, inside
	 * their transaction and before the lines are written
	 *
	 * Restates an order's reservation to `demands`. A variant asked for **more** than the order
	 * already held is checked against what others leave available - refused with 409 unless the
	 * variant allows backorders. Asking for the same or less is never refused, even when stock has
	 * shrunk since: the order already held those units.
	 *
	 * Untracked variants are dropped before anything is locked.
	 */
	public async reserveForOrder(
		manager: EntityManager,
		orderId: number,
		demands: readonly StockDemand[],
	): Promise<void> {
		const requested = demands.filter((demand) => demand.quantity > 0);
		const variantIds = [
			...new Set(requested.map((demand) => demand.variant_id)),
		].sort((a, b) => a - b);

		const variants =
			variantIds.length === 0
				? []
				: await manager.getRepository(ProductVariantEntity).find({
						select: {
							id: true,
							sku: true,
							allow_backorder: true,
						},
						where: { id: In(variantIds), track_stock: true },
						order: { id: 'ASC' },
						lock: { mode: 'for_no_key_update' },
					});

		const tracked = new Map(
			variants.map((variant) => [variant.id, variant]),
		);
		const wanted = requested.filter((demand) =>
			tracked.has(demand.variant_id),
		);

		const held = new Map(
			(
				await manager.getRepository(StockReservationEntity).find({
					select: { variant_id: true, quantity: true },
					where: { order_id: orderId },
				})
			).map((row) => [row.variant_id, Number(row.quantity)]),
		);

		const growing = wanted.filter(
			(demand) =>
				demand.quantity > (held.get(demand.variant_id) ?? 0) &&
				!tracked.get(demand.variant_id)?.allow_backorder,
		);

		if (growing.length > 0) {
			const ids = growing.map((demand) => demand.variant_id);
			const onHand = await this.sumOnHand(manager, ids);
			const reserved = await this.sumReserved(manager, ids, orderId);

			for (const demand of growing) {
				const available = roundQuantity(
					(onHand.get(demand.variant_id) ?? 0) -
						(reserved.get(demand.variant_id) ?? 0),
				);

				if (demand.quantity > available) {
					throw new CustomError(
						409,
						lang('warehouse-movement.error.insufficient_stock', {
							sku:
								tracked.get(demand.variant_id)?.sku ??
								`#${demand.variant_id}`,
							available: String(Math.max(available, 0)),
							requested: String(demand.quantity),
						}),
					);
				}
			}
		}

		await manager
			.getRepository(StockReservationEntity)
			.delete({ order_id: orderId });

		if (wanted.length > 0) {
			await manager.getRepository(StockReservationEntity).insert(
				wanted.map((demand) => ({
					order_id: orderId,
					variant_id: demand.variant_id,
					quantity: roundQuantity(demand.quantity),
				})),
			);
		}
	}

	/** @description Used through `order.hooks.ts` by `orderService.cancel`, inside its transaction */
	public async releaseForOrder(
		manager: EntityManager,
		orderId: number,
	): Promise<void> {
		await manager
			.getRepository(StockReservationEntity)
			.delete({ order_id: orderId });
	}

	/**
	 * @description Used by `WarehouseMovementService.shipDelivery`, inside the shipping transaction
	 *
	 * Lowers an order's reservation by what one of its deliveries just took out of stock - the
	 * promise is now a fact on the ledger. A row reaching zero is removed; one already lower than
	 * the shipment (an order reserved with a gap, or shipped beyond its lines) simply goes.
	 *
	 * The variants are locked after the lots (`consumeLots` took those), the order every stock
	 * transaction takes them in.
	 */
	public async consumeForOrder(
		manager: EntityManager,
		orderId: number,
		shipped: ReadonlyMap<number, number>,
	): Promise<void> {
		const variantIds = [...shipped.keys()].sort((a, b) => a - b);

		if (variantIds.length === 0) {
			return;
		}

		await this.lockVariants(manager, variantIds);

		const repository = manager.getRepository(StockReservationEntity);
		const rows = await repository.find({
			where: { order_id: orderId, variant_id: In(variantIds) },
		});

		for (const row of rows) {
			const left = roundQuantity(
				Number(row.quantity) - (shipped.get(row.variant_id) ?? 0),
			);

			if (left > 0) {
				await repository.update({ id: row.id }, { quantity: left });
			} else {
				await repository.delete({ id: row.id });
			}
		}
	}

	/**
	 * @description Used by `WarehouseMovementService.returnDelivery`, inside the shipping transaction
	 *
	 * Gives an order back the reservation a returned delivery had consumed - the goods are on hand
	 * again and the order still wants them. Only while the order is live and still `pending` or
	 * `confirmed`; a canceled or completed order holds nothing, and the units simply become
	 * available. Never refused: on hand rose by exactly what is reserved again.
	 */
	public async restoreForOrder(
		manager: EntityManager,
		orderId: number,
		returned: ReadonlyMap<number, number>,
	): Promise<void> {
		const variantIds = [...returned.keys()].sort((a, b) => a - b);

		if (variantIds.length === 0) {
			return;
		}

		const order = await manager.getRepository(OrderEntity).findOne({
			select: { id: true, status: true },
			where: { id: orderId },
		});

		if (
			!order ||
			!RESERVING_STATUSES.some((status) => status === order.status)
		) {
			return;
		}

		await this.lockVariants(manager, variantIds);

		for (const variantId of variantIds) {
			await manager.query(
				`
					INSERT INTO stock_reservation (order_id, variant_id, quantity)
					VALUES ($1, $2, $3)
					ON CONFLICT (order_id, variant_id)
					DO UPDATE SET quantity = stock_reservation.quantity + EXCLUDED.quantity
				`,
				[
					orderId,
					variantId,
					roundQuantity(returned.get(variantId) ?? 0),
				],
			);
		}
	}

	/** Takes the serializing lock on tracked variants, in id order - see the class note. */
	private async lockVariants(
		manager: EntityManager,
		variantIds: number[],
	): Promise<void> {
		await manager.getRepository(ProductVariantEntity).find({
			select: { id: true },
			where: { id: In(variantIds), track_stock: true },
			order: { id: 'ASC' },
			lock: { mode: 'for_no_key_update' },
		});
	}

	/**
	 * @description Used through `cart.hooks.ts` by `CartPricingService` while pricing a basket
	 *
	 * What can still be sold of each stock-tracked variant among `variantIds` - untracked or
	 * deleted ones are left out of the map, which the cart reads as "never short". A plain read,
	 * no lock: it quotes a basket, and the reservation at checkout is what holds the units.
	 */
	public async getAvailability(
		variantIds: readonly number[],
	): Promise<Map<number, VariantAvailability>> {
		if (variantIds.length === 0) {
			return new Map();
		}

		const manager = dataSource.manager;

		const variants = await manager
			.getRepository(ProductVariantEntity)
			.find({
				select: {
					id: true,
					allow_backorder: true,
					low_stock_threshold: true,
				},
				where: { id: In([...variantIds]), track_stock: true },
			});

		if (variants.length === 0) {
			return new Map();
		}

		const ids = variants.map((variant) => variant.id);
		const onHand = await this.sumOnHand(manager, ids);
		const reserved = await this.sumReserved(manager, ids);

		return new Map(
			variants.map((variant) => [
				variant.id,
				{
					available: roundQuantity(
						(onHand.get(variant.id) ?? 0) -
							(reserved.get(variant.id) ?? 0),
					),
					allow_backorder: variant.allow_backorder,
					low_stock_threshold: variant.low_stock_threshold,
				},
			]),
		);
	}

	/**
	 * @description Used in `stock` method from controller
	 *
	 * A variant's figures, with on hand broken down per warehouse. Inactive warehouses are listed -
	 * the goods are physically there - but left out of `on_hand` and `available`.
	 */
	public async getVariantStock(variantId: number): Promise<
		VariantStock & {
			variant_id: number;
			warehouses: WarehouseStock[];
		}
	> {
		const manager = dataSource.manager;

		const rows = await manager
			.getRepository(GrnItemEntity)
			.createQueryBuilder('item')
			.innerJoin(
				GrnEntity,
				'grn',
				'grn.id = item.grn_id AND grn.deleted_at IS NULL AND grn.status = :status',
				{ status: GrnStatusEnum.CONFIRMED },
			)
			.innerJoin(
				WarehouseEntity,
				'warehouse',
				'warehouse.id = grn.warehouse_id',
			)
			.select('warehouse.id', 'warehouse_id')
			.addSelect('warehouse.code', 'code')
			.addSelect('warehouse.name', 'name')
			.addSelect('warehouse.status', 'status')
			.addSelect('SUM(item.qty_remaining)', 'on_hand')
			.where('item.variant_id = :variantId', { variantId: variantId })
			.andWhere('item.qty_remaining > 0')
			.groupBy('warehouse.id')
			.orderBy('warehouse.id')
			.getRawMany<{
				warehouse_id: number;
				code: string;
				name: string;
				status: string;
				on_hand: string;
			}>();

		const warehouses = rows.map((row) => ({
			warehouse_id: Number(row.warehouse_id),
			code: row.code,
			name: row.name,
			status: row.status,
			on_hand: roundQuantity(Number(row.on_hand)),
		}));

		const onHand = roundQuantity(
			warehouses
				.filter((row) => row.status === WarehouseStatusEnum.ACTIVE)
				.reduce((sum, row) => sum + row.on_hand, 0),
		);
		const reserved =
			(await this.sumReserved(manager, [variantId])).get(variantId) ?? 0;

		return {
			variant_id: variantId,
			on_hand: onHand,
			reserved: reserved,
			available: roundQuantity(onHand - reserved),
			warehouses: warehouses,
		};
	}

	/**
	 * @description Used in the demo seed
	 *
	 * Reserves for every live `pending` or `confirmed` order that holds nothing yet - one placed
	 * before this feature was installed, or written by a seed, which runs without the bootstraps
	 * that fill `order.hooks.ts`. **Never refused for a shortage**: the order exists already, and an
	 * over-commitment is exactly what the figures should then show.
	 *
	 * What its deliveries already took away is left out (`GONE_DELIVERY_SQL`). Read off the shipment
	 * lines rather than the ledger, so goods that left with no lot behind them - a backfill short of
	 * stock - still count as gone.
	 *
	 * An order whose only lines are untracked holds nothing either, so it is picked again on every
	 * run - harmless, nothing is written for it, and it is not counted in the result.
	 */
	public async backfill(
		limit: number = 500,
		manager: EntityManager = dataSource.manager,
	): Promise<{ orders: number }> {
		const orders = await manager.query<{ id: number }[]>(
			`
				SELECT "order".id FROM "order"
				WHERE "order".deleted_at IS NULL
					AND "order".status = ANY($1)
					AND NOT EXISTS (
						SELECT 1 FROM stock_reservation
						WHERE stock_reservation.order_id = "order".id
					)
				ORDER BY "order".id
				LIMIT $2
			`,
			[RESERVING_STATUSES, limit],
		);

		if (orders.length === 0) {
			return { orders: 0 };
		}

		// Physical lines only: a header with components holds no stock, its components do
		const rows = await manager
			.getRepository(OrderLineEntity)
			.createQueryBuilder('line')
			.innerJoin(
				ProductVariantEntity,
				'variant',
				'variant.id = line.variant_id AND variant.track_stock = true',
			)
			.select('line.order_id', 'order_id')
			.addSelect('line.variant_id', 'variant_id')
			.addSelect('SUM(line.quantity)', 'quantity')
			.where('line.order_id IN (:...orderIds)', {
				orderIds: orders.map((order) => order.id),
			})
			.andWhere(
				'NOT EXISTS (SELECT 1 FROM order_line child WHERE child.parent_id = line.id)',
			)
			.groupBy('line.order_id')
			.addGroupBy('line.variant_id')
			.getRawMany<{
				order_id: number;
				variant_id: number;
				quantity: string;
			}>();

		const shipped = await manager.query<
			{ order_id: number; variant_id: number; quantity: string }[]
		>(
			`
				SELECT shipping.order_id, shipping_line.variant_id, SUM(shipping_line.quantity) AS quantity
				FROM shipping_line
				INNER JOIN shipping ON shipping.id = shipping_line.shipping_id
				WHERE shipping.order_id = ANY($1)
					AND ${GONE_DELIVERY_SQL}
				GROUP BY shipping.order_id, shipping_line.variant_id
			`,
			[orders.map((order) => order.id)],
		);

		const gone = new Map(
			shipped.map((row) => [
				`${row.order_id}:${row.variant_id}`,
				Number(row.quantity),
			]),
		);

		const reservations = rows
			.map((row) => ({
				order_id: Number(row.order_id),
				variant_id: Number(row.variant_id),
				quantity: roundQuantity(
					Number(row.quantity) -
						(gone.get(`${row.order_id}:${row.variant_id}`) ?? 0),
				),
			}))
			.filter((row) => row.quantity > 0);

		if (reservations.length > 0) {
			await manager
				.getRepository(StockReservationEntity)
				.insert(reservations);
		}

		// Orders that got a row, not orders looked at - see the note on untracked-only orders
		return {
			orders: new Set(reservations.map((row) => row.order_id)).size,
		};
	}

	/**
	 * Open lots on confirmed, live receipts in active warehouses, for `variantIds`. Ungrouped -
	 * each caller adds the grouping it needs, so the per-variant and per-site figures stay one
	 * definition of "on hand".
	 */
	private onHandQuery(manager: EntityManager, variantIds: number[]) {
		return manager
			.getRepository(GrnItemEntity)
			.createQueryBuilder('item')
			.innerJoin(
				GrnEntity,
				'grn',
				'grn.id = item.grn_id AND grn.deleted_at IS NULL AND grn.status = :status',
				{ status: GrnStatusEnum.CONFIRMED },
			)
			.innerJoin(
				WarehouseEntity,
				'warehouse',
				'warehouse.id = grn.warehouse_id AND warehouse.status = :warehouseStatus',
				{ warehouseStatus: WarehouseStatusEnum.ACTIVE },
			)
			.select('item.variant_id', 'variant_id')
			.addSelect('SUM(item.qty_remaining)', 'on_hand')
			.where('item.variant_id IN (:...variantIds)', {
				variantIds: variantIds,
			})
			.andWhere('item.qty_remaining > 0');
	}

	/** Open lots on confirmed, live receipts in active warehouses, per variant. */
	private async sumOnHand(
		manager: EntityManager,
		variantIds: number[],
	): Promise<Map<number, number>> {
		const rows = await this.onHandQuery(manager, variantIds)
			.groupBy('item.variant_id')
			.getRawMany<{ variant_id: number; on_hand: string }>();

		return new Map(
			rows.map((row) => [
				Number(row.variant_id),
				roundQuantity(Number(row.on_hand)),
			]),
		);
	}

	/**
	 * @description Used through `cart.hooks.ts` by `CartService.toOrder`, inside the checkout
	 * transaction and after the order has reserved its stock
	 *
	 * What each active warehouse can still send of each stock-tracked variant among `variantIds`:
	 * its open lots less what live deliveries **not yet shipped** (`pending`, `preparing`) are set
	 * to pick from it. Untracked or deleted variants are left out; a site holding none of a
	 * variant is absent from its inner map.
	 *
	 * Unshipped deliveries are the only per-site claim there is - a reservation names a variant,
	 * not a warehouse (see `StockReservationEntity`). So an order that reserves without a delivery,
	 * as a back-office order may, is not subtracted from any site here. The per-variant
	 * reservation has already refused a checkout the business cannot cover overall, and the FIFO
	 * draw on `shipped` is the last word on a site that turns out short.
	 */
	public async getWarehouseAvailability(
		manager: EntityManager,
		variantIds: readonly number[],
	): Promise<WarehouseAvailability> {
		if (variantIds.length === 0) {
			return new Map();
		}

		const variants = await manager
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true },
				where: { id: In([...variantIds]), track_stock: true },
			});

		if (variants.length === 0) {
			return new Map();
		}

		const ids = variants.map((variant) => variant.id);

		const onHand = await this.onHandQuery(manager, ids)
			.addSelect('grn.warehouse_id', 'warehouse_id')
			.groupBy('item.variant_id')
			.addGroupBy('grn.warehouse_id')
			.getRawMany<{
				variant_id: number;
				warehouse_id: number;
				on_hand: string;
			}>();

		const committed = await manager
			.getRepository(ShippingLineEntity)
			.createQueryBuilder('line')
			.innerJoin(
				ShippingEntity,
				'shipping',
				'shipping.id = line.shipping_id AND shipping.deleted_at IS NULL',
			)
			.innerJoin(
				OrderEntity,
				'shipping_order',
				'shipping_order.id = shipping.order_id AND shipping_order.deleted_at IS NULL',
			)
			.select('line.variant_id', 'variant_id')
			.addSelect('shipping.pickup_warehouse_id', 'warehouse_id')
			.addSelect('SUM(line.quantity)', 'committed')
			.where('line.variant_id IN (:...variantIds)', { variantIds: ids })
			.andWhere('line.deleted_at IS NULL')
			.andWhere('shipping.scope = :scope', {
				scope: ShippingScopeEnum.DELIVERY,
			})
			.andWhere('shipping.status IN (:...statuses)', {
				statuses: [
					ShippingStatusEnum.PENDING,
					ShippingStatusEnum.PREPARING,
				],
			})
			.andWhere('shipping.pickup_warehouse_id IS NOT NULL')
			.groupBy('line.variant_id')
			.addGroupBy('shipping.pickup_warehouse_id')
			.getRawMany<{
				variant_id: number;
				warehouse_id: number;
				committed: string;
			}>();

		const result: WarehouseAvailability = new Map(
			ids.map((id) => [id, new Map<number, number>()]),
		);

		for (const row of onHand) {
			result
				.get(Number(row.variant_id))
				?.set(
					Number(row.warehouse_id),
					roundQuantity(Number(row.on_hand)),
				);
		}

		// Only sites with stock are listed: a claim on a site holding nothing is no supply either way
		for (const row of committed) {
			const sites = result.get(Number(row.variant_id));
			const siteId = Number(row.warehouse_id);
			const held = sites?.get(siteId);

			if (sites && held !== undefined) {
				sites.set(siteId, roundQuantity(held - Number(row.committed)));
			}
		}

		return result;
	}

	/** What live orders reserve per variant, leaving out `excludeOrderId`'s own rows. */
	private async sumReserved(
		manager: EntityManager,
		variantIds: number[],
		excludeOrderId?: number,
	): Promise<Map<number, number>> {
		const query = manager
			.getRepository(StockReservationEntity)
			.createQueryBuilder('reservation')
			.innerJoin(
				OrderEntity,
				'reserving_order',
				'reserving_order.id = reservation.order_id AND reserving_order.deleted_at IS NULL',
			)
			.select('reservation.variant_id', 'variant_id')
			.addSelect('SUM(reservation.quantity)', 'reserved')
			.where('reservation.variant_id IN (:...variantIds)', {
				variantIds: variantIds,
			})
			.groupBy('reservation.variant_id');

		if (excludeOrderId !== undefined) {
			query.andWhere('reservation.order_id <> :excludeOrderId', {
				excludeOrderId: excludeOrderId,
			});
		}

		const rows = await query.getRawMany<{
			variant_id: number;
			reserved: string;
		}>();

		return new Map(
			rows.map((row) => [
				Number(row.variant_id),
				roundQuantity(Number(row.reserved)),
			]),
		);
	}
}

export const stockReservationService = new StockReservationService();
