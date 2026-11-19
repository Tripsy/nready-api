import { type EntityManager, In, IsNull, Not } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import { GrnStatusEnum } from '@/features/grn/grn.entity';
import type { LotMovement, StockReceipt } from '@/features/grn/grn.hooks';
import { grnService } from '@/features/grn/grn.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ShippingEntity, {
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import type { ShippingStockMove } from '@/features/shipping/shipping.hooks';
import ShippingLineEntity, {
	ShippingLineConditionEnum,
} from '@/features/shipping/shipping-line.entity';
import { stockReservationService } from '@/features/warehouse-movement/stock-reservation.service';
import WarehouseMovementEntity, {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import { getWarehouseMovementRepository } from '@/features/warehouse-movement/warehouse-movement.repository';
import type { WarehouseMovementValidator } from '@/features/warehouse-movement/warehouse-movement.validator';
import type { ValidatorOutput } from '@/shared/types/mock.type';

const ENTRY_COLUMNS = [
	'warehouse_movement.id',
	'warehouse_movement.movement_type',
	'warehouse_movement.qty',
	'warehouse_movement.unit_cost_base',
	'warehouse_movement.source_type',
	'warehouse_movement.source_id',
	'warehouse_movement.occurred_at',
	'warehouse_movement.notes',
	'warehouse_movement.warehouse_id',
	'warehouse_movement.variant_id',
	'warehouse_movement.grn_item_id',
	'warehouse_movement.reversal_of_id',
	'warehouse_movement.created_at',
];

const WAREHOUSE_COLUMNS = ['warehouse.id', 'warehouse.code', 'warehouse.name'];

// Joined LEFT, so a movement is never dropped from the ledger for what its variant became since
const VARIANT_COLUMNS = ['variant.id', 'variant.sku', 'variant.product_id'];

/**
 * The stock ledger: written by the documents that move goods, read by people.
 *
 * Nothing here is reachable from a request that writes. Every row comes from a document - a goods
 * receipt, a delivery shipping or coming back - inside the transaction that moves the stock,
 * through the slot that document's feature declares (`grn.hooks.ts`, `shipping.hooks.ts`). A
 * mistake is corrected by posting a reversing row, never by editing one.
 *
 * A `delivery` draws its goods as it ships and puts them back if it comes back undelivered; a
 * client's `return` takes them back in as it arrives (`receiveReturn`). A `relocation` changes
 * nothing yet: moving a lot between warehouses needs a lot that can split across sites, which
 * `grn_item` - one row, one receipt, one warehouse - cannot be.
 */
export class WarehouseMovementService {
	constructor(
		private repository: ReturnType<typeof getWarehouseMovementRepository>,
	) {}

	/**
	 * @description Used through `grn.hooks.ts` by `grnService.confirmWithin`, and by `backfill`
	 *
	 * One `receipt` per confirmed line, at the lot's base cost and on the receiving day.
	 */
	public async recordReceipts(
		manager: EntityManager,
		receipts: StockReceipt[],
	): Promise<void> {
		if (receipts.length === 0) {
			return;
		}

		await manager.save(
			receipts.map((receipt) =>
				manager.create(WarehouseMovementEntity, {
					movement_type: WarehouseMovementTypeEnum.RECEIPT,
					qty: receipt.qty,
					unit_cost_base: receipt.unit_cost_base,
					source_type: WarehouseMovementSourceEnum.GRN_ITEM,
					source_id: receipt.grn_item_id,
					occurred_at: receipt.occurred_at,
					warehouse_id: receipt.warehouse_id,
					variant_id: receipt.variant_id,
					grn_item_id: receipt.grn_item_id,
					reversal_of_id: null,
					notes: null,
				}),
			),
		);
	}

	/**
	 * @description Used through `grn.hooks.ts` by `grnService.cancelWithin`
	 *
	 * The first row on any of the lots besides its own receipt - a sale, a return, a write-off, or
	 * a reversal already posted. Lowest id first, so the answer is stable.
	 */
	public async findLotMovement(
		manager: EntityManager,
		grnItemIds: number[],
	): Promise<LotMovement | null> {
		if (grnItemIds.length === 0) {
			return null;
		}

		const moved = await manager
			.getRepository(WarehouseMovementEntity)
			.findOne({
				select: {
					id: true,
					grn_item_id: true,
					variant_id: true,
					movement_type: true,
				},
				where: {
					grn_item_id: In(grnItemIds),
					movement_type: Not(WarehouseMovementTypeEnum.RECEIPT),
				},
				order: { id: 'ASC' },
			});

		if (!moved) {
			return null;
		}

		return {
			grn_item_id: moved.grn_item_id,
			variant_id: moved.variant_id,
			movement_type: moved.movement_type,
		};
	}

	/**
	 * @description Used through `grn.hooks.ts` by `grnService.cancelWithin`, and by `backfill`
	 *
	 * Answers each lot's `receipt` with an opposing row pointing at it through `reversal_of_id`. It
	 * is an `adjustment`, the one movement type the direction CHECK lets carry a negative quantity
	 * for a correction. `IDX_warehouse_movement_reversal_of_id` stops a second reversal of the same
	 * receipt - a retry fails on the index rather than double-counting.
	 *
	 * A lot with no receipt (confirmed before this feature was installed, not yet backfilled) is
	 * simply skipped: there is nothing on the ledger to cancel.
	 */
	public async reverseReceipts(
		manager: EntityManager,
		grnItemIds: number[],
		occurredAt: Date,
	): Promise<void> {
		if (grnItemIds.length === 0) {
			return;
		}

		const receipts = await manager
			.getRepository(WarehouseMovementEntity)
			.find({
				where: {
					grn_item_id: In(grnItemIds),
					movement_type: WarehouseMovementTypeEnum.RECEIPT,
				},
				order: { id: 'ASC' },
			});

		if (receipts.length === 0) {
			return;
		}

		await manager.save(
			receipts.map((receipt) =>
				manager.create(WarehouseMovementEntity, {
					movement_type: WarehouseMovementTypeEnum.ADJUSTMENT,
					qty: -receipt.qty,
					unit_cost_base: receipt.unit_cost_base,
					source_type: receipt.source_type,
					source_id: receipt.source_id,
					occurred_at: occurredAt,
					warehouse_id: receipt.warehouse_id,
					variant_id: receipt.variant_id,
					grn_item_id: receipt.grn_item_id,
					reversal_of_id: receipt.id,
					// `reversal_of_id` is what says this row cancels another; no prose is stored beside it
					notes: null,
				}),
			),
		);
	}

	/**
	 * @description Used through `shipping.hooks.ts` by `shippingService.updateStatus` (into
	 * `shipped`), and by `backfillShipments`
	 *
	 * Draws a delivery's tracked lines from its pickup warehouse's lots, oldest first, and posts one
	 * `sale` per lot drawn - a line of 14 against lots of 10 and 10 is two rows at two costs, each
	 * naming the shipment line as its source. Then the order's reservation drops by what left.
	 *
	 * A shortage refuses the move with 409 (`grnService.consumeLots`), even on a variant sold on
	 * backorder: it can be sold with nothing on hand, never shipped from nothing. Untracked
	 * variants travel with no stock drawn.
	 */
	public async shipDelivery(
		manager: EntityManager,
		move: ShippingStockMove,
		options: { allowShort?: boolean; occurredAt?: Date } = {},
	): Promise<void> {
		if (
			move.scope !== ShippingScopeEnum.DELIVERY ||
			!move.pickup_warehouse_id
		) {
			return;
		}

		const lines = await this.trackedLines(manager, move.shipping_id);

		if (lines.length === 0) {
			return;
		}

		const pieces = await grnService.consumeLots(
			manager,
			move.pickup_warehouse_id,
			lines.map((line) => ({
				key: line.id,
				variant_id: line.variant_id,
				quantity: Number(line.quantity),
			})),
			{ allowShort: options.allowShort },
		);

		const occurredAt = options.occurredAt ?? new Date();

		if (pieces.length > 0) {
			await manager.save(
				pieces.map((piece) =>
					manager.create(WarehouseMovementEntity, {
						movement_type: WarehouseMovementTypeEnum.SALE,
						qty: -piece.qty,
						unit_cost_base: piece.unit_cost_base,
						source_type: WarehouseMovementSourceEnum.SHIPPING_LINE,
						source_id: piece.key,
						occurred_at: occurredAt,
						warehouse_id: move.pickup_warehouse_id as number,
						variant_id: piece.variant_id,
						grn_item_id: piece.grn_item_id,
						reversal_of_id: null,
						notes: null,
					}),
				),
			);
		}

		if (move.order_id) {
			// What the lines say left, not what lots covered: on a backfill short of stock the goods
			// still went, and the promise with them
			await stockReservationService.consumeForOrder(
				manager,
				move.order_id,
				this.sumByVariant(
					lines.map((line) => ({
						variant_id: line.variant_id,
						qty: Number(line.quantity),
					})),
				),
			);
		}
	}

	/**
	 * @description Used through `shipping.hooks.ts` by `shippingService.updateStatus` (`shipped`
	 * into `returned`), and by `backfillShipments`
	 *
	 * The parcel came back undelivered: each `sale` the delivery posted is answered by a
	 * `sale_return` with `reversal_of_id` set, into the same lot at the same cost, and the lots get
	 * their units back. The order's reservation is given back while it still wants the goods.
	 *
	 * Sales already reversed are skipped, and `IDX_warehouse_movement_reversal_of_id` refuses a
	 * second reversal of the same row anyway.
	 */
	public async returnDelivery(
		manager: EntityManager,
		move: ShippingStockMove,
		options: { occurredAt?: Date } = {},
	): Promise<void> {
		if (move.scope !== ShippingScopeEnum.DELIVERY) {
			return;
		}

		const lineIds = (
			await manager.getRepository(ShippingLineEntity).find({
				select: { id: true },
				where: { shipping_id: move.shipping_id },
				withDeleted: true,
			})
		).map((line) => line.id);

		if (lineIds.length === 0) {
			return;
		}

		const repository = manager.getRepository(WarehouseMovementEntity);
		const sales = await repository.find({
			where: {
				source_type: WarehouseMovementSourceEnum.SHIPPING_LINE,
				source_id: In(lineIds),
				movement_type: WarehouseMovementTypeEnum.SALE,
			},
			order: { id: 'ASC' },
		});

		const reversed = new Set(
			sales.length === 0
				? []
				: (
						await repository.find({
							select: { reversal_of_id: true },
							where: {
								reversal_of_id: In(
									sales.map((sale) => sale.id),
								),
							},
						})
					).map((row) => row.reversal_of_id),
		);

		const open = sales.filter((sale) => !reversed.has(sale.id));

		if (open.length === 0) {
			return;
		}

		await grnService.restoreLots(
			manager,
			open.flatMap((sale) =>
				sale.grn_item_id === null
					? []
					: [{ grn_item_id: sale.grn_item_id, qty: -sale.qty }],
			),
		);

		const occurredAt = options.occurredAt ?? new Date();

		await manager.save(
			open.map((sale) =>
				manager.create(WarehouseMovementEntity, {
					movement_type: WarehouseMovementTypeEnum.SALE_RETURN,
					qty: -sale.qty,
					unit_cost_base: sale.unit_cost_base,
					source_type: sale.source_type,
					source_id: sale.source_id,
					occurred_at: occurredAt,
					warehouse_id: sale.warehouse_id,
					variant_id: sale.variant_id,
					grn_item_id: sale.grn_item_id,
					reversal_of_id: sale.id,
					notes: null,
				}),
			),
		);

		if (move.order_id) {
			await stockReservationService.restoreForOrder(
				manager,
				move.order_id,
				this.sumByVariant(
					open.map((sale) => ({
						variant_id: sale.variant_id,
						qty: -sale.qty,
					})),
				),
			);
		}
	}

	/**
	 * @description Used through `shipping.hooks.ts` by `shippingService.updateStatus` (a `return`
	 * into `delivered`)
	 *
	 * Goods a client sent back arrive at the return's destination warehouse. Each tracked line goes
	 * back into the lots the order's own sales drew from **at that warehouse**, newest sale first -
	 * at the cost it left with, which is what keeps cost of goods honest across the round trip.
	 *
	 * - `resellable` - a `sale_return` per lot, and the lot gets the units back.
	 * - `damaged` - the same `sale_return`, then a `write_off` of it on the same lot, so
	 *   `qty_remaining` does not move. The ledger says the goods came home and why they are not on
	 *   the shelf; putting them back would get them picked and sold again.
	 *
	 * Both rows name the return's line as their source and carry no `reversal_of_id`: a sale can be
	 * returned in several parcels, and `IDX_warehouse_movement_reversal_of_id` allows one reversal
	 * per row - that key stays for the undelivered parcel `returnDelivery` takes back whole.
	 *
	 * What a lot can still take back = what the order's sales drew from it, less what undelivered
	 * parcels and earlier returns of the same order already put back. A line the destination's lots
	 * cannot absorb answers 409: the goods left from another site, and with lots tied to the
	 * warehouse of their receipt they cannot be booked in here (TODO.md, relocations). Untracked
	 * variants come back with nothing posted.
	 *
	 * The count is read inside the status transaction but behind the return's own row lock only, so
	 * two returns of one order received at the same instant could read the same room. The shipping
	 * cap already keeps the two from bringing back more than was delivered in total.
	 */
	public async receiveReturn(
		manager: EntityManager,
		move: ShippingStockMove,
		options: { occurredAt?: Date } = {},
	): Promise<void> {
		if (
			move.scope !== ShippingScopeEnum.RETURN ||
			!move.order_id ||
			!move.destination_warehouse_id
		) {
			return;
		}

		const warehouseId = move.destination_warehouse_id;
		const lines = await this.trackedLines(manager, move.shipping_id);

		if (lines.length === 0) {
			return;
		}

		const variantIds = [...new Set(lines.map((line) => line.variant_id))];

		const [deliveryLineIds, returnLineIds] = await Promise.all([
			this.orderLineIds(
				manager,
				move.order_id,
				ShippingScopeEnum.DELIVERY,
			),
			this.orderLineIds(manager, move.order_id, ShippingScopeEnum.RETURN),
		]);

		const repository = manager.getRepository(WarehouseMovementEntity);

		const sales =
			deliveryLineIds.length === 0
				? []
				: await repository.find({
						where: {
							source_type:
								WarehouseMovementSourceEnum.SHIPPING_LINE,
							source_id: In(deliveryLineIds),
							movement_type: WarehouseMovementTypeEnum.SALE,
							warehouse_id: warehouseId,
							variant_id: In(variantIds),
						},
						order: { occurred_at: 'DESC', id: 'DESC' },
					});

		const [undelivered, returned] = await Promise.all([
			sales.length === 0
				? []
				: repository.find({
						select: { reversal_of_id: true, qty: true },
						where: {
							reversal_of_id: In(sales.map((sale) => sale.id)),
						},
					}),
			returnLineIds.length === 0
				? []
				: repository.find({
						select: { grn_item_id: true, qty: true },
						where: {
							source_type:
								WarehouseMovementSourceEnum.SHIPPING_LINE,
							source_id: In(returnLineIds),
							movement_type:
								WarehouseMovementTypeEnum.SALE_RETURN,
							reversal_of_id: IsNull(),
						},
					}),
		]);

		const saleLot = new Map(
			sales.map((sale) => [sale.id, sale.grn_item_id]),
		);

		// What each lot can still take back for this order, and the lots in the order to fill them
		const room = new Map<number, number>();
		const lotsByVariant = new Map<
			number,
			{ grn_item_id: number; unit_cost_base: number }[]
		>();

		for (const sale of sales) {
			if (sale.grn_item_id === null) {
				continue;
			}

			room.set(
				sale.grn_item_id,
				(room.get(sale.grn_item_id) ?? 0) - sale.qty,
			);

			const lots = lotsByVariant.get(sale.variant_id) ?? [];

			if (!lots.some((lot) => lot.grn_item_id === sale.grn_item_id)) {
				lots.push({
					grn_item_id: sale.grn_item_id,
					unit_cost_base: sale.unit_cost_base,
				});
			}

			lotsByVariant.set(sale.variant_id, lots);
		}

		for (const row of undelivered) {
			const lot = row.reversal_of_id
				? saleLot.get(row.reversal_of_id)
				: null;

			if (lot) {
				room.set(lot, (room.get(lot) ?? 0) - row.qty);
			}
		}

		for (const row of returned) {
			if (row.grn_item_id !== null && room.has(row.grn_item_id)) {
				room.set(
					row.grn_item_id,
					(room.get(row.grn_item_id) ?? 0) - row.qty,
				);
			}
		}

		const occurredAt = options.occurredAt ?? new Date();
		const restocked: { grn_item_id: number; qty: number }[] = [];
		const rows: WarehouseMovementEntity[] = [];

		for (const line of lines) {
			let need = Number(line.quantity);

			for (const lot of lotsByVariant.get(line.variant_id) ?? []) {
				const take =
					Math.round(
						Math.min(need, room.get(lot.grn_item_id) ?? 0) * 100,
					) / 100;

				if (take <= 0) {
					continue;
				}

				room.set(
					lot.grn_item_id,
					(room.get(lot.grn_item_id) ?? 0) - take,
				);
				need = Math.round((need - take) * 100) / 100;

				const base = {
					unit_cost_base: lot.unit_cost_base,
					source_type: WarehouseMovementSourceEnum.SHIPPING_LINE,
					source_id: line.id,
					occurred_at: occurredAt,
					warehouse_id: warehouseId,
					variant_id: line.variant_id,
					grn_item_id: lot.grn_item_id,
					reversal_of_id: null,
					notes: null,
				};

				rows.push(
					manager.create(WarehouseMovementEntity, {
						...base,
						movement_type: WarehouseMovementTypeEnum.SALE_RETURN,
						qty: take,
					}),
				);

				if (line.condition === ShippingLineConditionEnum.DAMAGED) {
					rows.push(
						manager.create(WarehouseMovementEntity, {
							...base,
							movement_type: WarehouseMovementTypeEnum.WRITE_OFF,
							qty: -take,
						}),
					);
				} else {
					restocked.push({ grn_item_id: lot.grn_item_id, qty: take });
				}

				if (need <= 0) {
					break;
				}
			}

			if (need > 0) {
				throw new CustomError(
					409,
					lang('warehouse-movement.error.return_not_from_warehouse', {
						variant_id: String(line.variant_id),
						warehouse_id: String(warehouseId),
						remaining: String(need),
					}),
				);
			}
		}

		await grnService.restoreLots(manager, restocked);

		if (rows.length > 0) {
			await manager.save(rows);
		}
	}

	/** Every line ever written on the order's movements of one scope, deleted movements included. */
	private async orderLineIds(
		manager: EntityManager,
		orderId: number,
		scope:
			| typeof ShippingScopeEnum.DELIVERY
			| typeof ShippingScopeEnum.RETURN,
	): Promise<number[]> {
		const rows = await manager
			.getRepository(ShippingLineEntity)
			.createQueryBuilder('line')
			.withDeleted()
			.innerJoin(
				ShippingEntity,
				'shipping',
				'shipping.id = line.shipping_id',
			)
			.where('shipping.order_id = :orderId', { orderId: orderId })
			.andWhere('shipping.scope = :scope', { scope: scope })
			.select('line.id', 'id')
			.getRawMany<{ id: number }>();

		return rows.map((row) => Number(row.id));
	}

	/**
	 * @description Used in the demo seed
	 *
	 * Draws the stock of every delivery that left - `shipped`, `delivered` or `returned` - but has
	 * no `sale` on the ledger: shipped while this feature was not installed, or written by a seed.
	 * Short lots are taken as far as they go (`allowShort`): the goods left, and refusing now would
	 * change nothing. A `returned` delivery is then reversed straight away. Dated at `shipped_at`.
	 *
	 * Run after the reservation backfill, which leaves shipped goods out of what it reserves - so
	 * the consumption here finds nothing to lower for them and the two agree.
	 */
	public async backfillShipments(
		limit: number = 500,
		manager: EntityManager = dataSource.manager,
	): Promise<{ shippings: number }> {
		const rows = await manager.query<{ id: number }[]>(
			`
				SELECT shipping.id FROM shipping
				WHERE shipping.deleted_at IS NULL
					AND shipping.scope = $1
					AND shipping.status = ANY($2)
					AND NOT EXISTS (
						SELECT 1 FROM warehouse_movement
						INNER JOIN shipping_line ON shipping_line.id = warehouse_movement.source_id
						WHERE warehouse_movement.source_type = $3
							AND shipping_line.shipping_id = shipping.id
					)
				ORDER BY shipping.id
				LIMIT $4
			`,
			[
				ShippingScopeEnum.DELIVERY,
				[
					ShippingStatusEnum.SHIPPED,
					ShippingStatusEnum.DELIVERED,
					ShippingStatusEnum.RETURNED,
				],
				WarehouseMovementSourceEnum.SHIPPING_LINE,
				limit,
			],
		);

		for (const row of rows) {
			const shipping = await manager
				.getRepository(ShippingEntity)
				.findOneByOrFail({ id: row.id });

			const move: ShippingStockMove = {
				shipping_id: shipping.id,
				order_id: shipping.order_id,
				scope: shipping.scope,
				pickup_warehouse_id: shipping.pickup_warehouse_id,
				destination_warehouse_id: shipping.destination_warehouse_id,
			};
			const occurredAt = shipping.shipped_at ?? shipping.created_at;

			await this.shipDelivery(manager, move, {
				allowShort: true,
				occurredAt: occurredAt,
			});

			if (shipping.status === ShippingStatusEnum.RETURNED) {
				await this.returnDelivery(manager, move, {
					occurredAt: shipping.updated_at ?? occurredAt,
				});
			}
		}

		return { shippings: rows.length };
	}

	/** A movement's lines whose variant tracks stock. */
	private async trackedLines(
		manager: EntityManager,
		shippingId: number,
	): Promise<ShippingLineEntity[]> {
		const lines = await manager.getRepository(ShippingLineEntity).find({
			select: {
				id: true,
				variant_id: true,
				quantity: true,
				condition: true,
			},
			where: { shipping_id: shippingId },
			order: { id: 'ASC' },
		});

		if (lines.length === 0) {
			return [];
		}

		const tracked = new Set(
			(
				await manager.getRepository(ProductVariantEntity).find({
					select: { id: true },
					where: {
						id: In([
							...new Set(lines.map((line) => line.variant_id)),
						]),
						track_stock: true,
					},
					withDeleted: true,
				})
			).map((variant) => variant.id),
		);

		return lines.filter(
			(line) => tracked.has(line.variant_id) && Number(line.quantity) > 0,
		);
	}

	private sumByVariant(
		rows: readonly { variant_id: number; qty: number }[],
	): Map<number, number> {
		const totals = new Map<number, number>();

		for (const row of rows) {
			totals.set(
				row.variant_id,
				Math.round(
					((totals.get(row.variant_id) ?? 0) + row.qty) * 100,
				) / 100,
			);
		}

		return totals;
	}

	/**
	 * @description Used in the demo seed
	 *
	 * Posts the movements every receipt that left draft implies but the ledger does not hold - one
	 * confirmed while this feature was not installed, or written by a seed, which runs without the
	 * bootstraps that fill `grn.hooks.ts`. A receipt canceled after confirmation gets its receipt and
	 * the reversal of it, dated at the receipt's last update - the closest record of the cancel.
	 *
	 * Idempotent: only lots with no `receipt` row are picked, so a re-run inserts nothing. Batched by
	 * receipt; a backlog clears over consecutive runs.
	 */
	public async backfill(
		limit: number = 500,
		manager: EntityManager = dataSource.manager,
	): Promise<{ grn_items: number }> {
		const rows = await manager.query<
			{
				grn_item_id: number;
				warehouse_id: number;
				variant_id: number;
				qty: string;
				unit_cost_base: string;
				received_at: Date;
				status: string;
				updated_at: Date;
			}[]
		>(
			`
				SELECT
					grn_item.id AS grn_item_id,
					grn.warehouse_id,
					grn_item.variant_id,
					grn_item.qty,
					grn_item.unit_cost_base,
					grn.received_at,
					grn.status,
					grn.updated_at
				FROM grn_item
				INNER JOIN grn ON grn.id = grn_item.grn_id
				WHERE grn.confirmed_at IS NOT NULL
					AND NOT EXISTS (
						SELECT 1 FROM warehouse_movement
						WHERE warehouse_movement.grn_item_id = grn_item.id
							AND warehouse_movement.movement_type = $1
					)
				ORDER BY grn.id, grn_item.id
				LIMIT $2
			`,
			[WarehouseMovementTypeEnum.RECEIPT, limit],
		);

		await this.recordReceipts(
			manager,
			rows.map((row) => ({
				grn_item_id: row.grn_item_id,
				warehouse_id: row.warehouse_id,
				variant_id: row.variant_id,
				qty: Number(row.qty),
				unit_cost_base: Number(row.unit_cost_base),
				occurred_at: row.received_at,
			})),
		);

		// `confirmed_at` is kept on cancel, so a canceled row here is one that had moved stock
		const canceled = rows.filter(
			(row) => row.status === GrnStatusEnum.CANCELED,
		);

		for (const row of canceled) {
			await this.reverseReceipts(
				manager,
				[row.grn_item_id],
				row.updated_at,
			);
		}

		return { grn_items: rows.length };
	}

	/** @description Used in `read` method from controller */
	/**
	 * A ledger read names what it points at - the warehouse and the variant's SKU - so a row reads
	 * as more than a pair of ids. `join`, not `joinAndSelect`: the named columns only, never the
	 * warehouse's notes or the variant's prices.
	 */
	private createLedgerQuery() {
		return this.repository
			.createQuery()
			.select([
				...ENTRY_COLUMNS,
				...WAREHOUSE_COLUMNS,
				...VARIANT_COLUMNS,
			])
			.join('warehouse_movement.warehouse', 'warehouse', 'LEFT')
			.join('warehouse_movement.variant', 'variant', 'LEFT');
	}

	/** @description Used in `read` method from controller */
	public findById(id: number): Promise<WarehouseMovementEntity> {
		return this.createLedgerQuery().filterById(id).firstOrFail();
	}

	/** @description Used in `find` method from controller */
	public findByFilter(
		data: ValidatorOutput<WarehouseMovementValidator, 'find'>,
	) {
		return this.createLedgerQuery()
			.filterBy('warehouse_id', data.filter.warehouse_id)
			.filterBy('variant_id', data.filter.variant_id)
			.filterBy('grn_item_id', data.filter.grn_item_id)
			.filterBy('movement_type', data.filter.movement_type)
			.filterBy('source_type', data.filter.source_type)
			.filterBy('source_id', data.filter.source_id)
			.filterByRange(
				'occurred_at',
				data.filter.occurred_at_start,
				data.filter.occurred_at_end,
			)
			.filterBy('reversal_of_id', data.filter.reversal_of_id)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const warehouseMovementService = new WarehouseMovementService(
	getWarehouseMovementRepository(),
);
