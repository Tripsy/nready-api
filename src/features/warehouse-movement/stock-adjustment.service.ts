import { type EntityManager, IsNull } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError, NotFoundError } from '@/exceptions';
import { grnService, type SiteLot } from '@/features/grn/grn.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';
import StockAdjustmentEntity, {
	STATUS_TRANSITIONS,
	StockAdjustmentDirectionEnum,
	type StockAdjustmentReason,
	StockAdjustmentReasonEnum,
	StockAdjustmentStatusEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import { getStockAdjustmentRepository } from '@/features/warehouse-movement/stock-adjustment.repository';
import type { StockAdjustmentValidator } from '@/features/warehouse-movement/stock-adjustment.validator';
import WarehouseMovementEntity, {
	WarehouseMovementSourceEnum,
	type WarehouseMovementType,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import { roundMoney } from '@/helpers/shop.helper';
import { assertValidStatusTransition } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

const ENTRY_COLUMNS = [
	'stock_adjustment.id',
	'stock_adjustment.reason',
	'stock_adjustment.qty',
	'stock_adjustment.status',
	'stock_adjustment.reversed_at',
	'stock_adjustment.notes',
	'stock_adjustment.warehouse_id',
	'stock_adjustment.variant_id',
	'stock_adjustment.created_at',
	'stock_adjustment.updated_at',
];

const WAREHOUSE_COLUMNS = ['warehouse.id', 'warehouse.code', 'warehouse.name'];

// Joined LEFT, so an adjustment is never dropped from the list for what its variant became since
const VARIANT_COLUMNS = ['variant.id', 'variant.sku', 'variant.product_id'];

/**
 * The ledger type a removal is posted as. A loss - goods broken, expired, stolen, gone, given away
 * - is a `write_off`, the type stock reports value as lost; a count that found fewer only corrects
 * the books, so it stays an `adjustment`, as everything added does.
 */
const LOSS_REASONS: ReadonlySet<StockAdjustmentReason> = new Set([
	StockAdjustmentReasonEnum.DAMAGED,
	StockAdjustmentReasonEnum.EXPIRED,
	StockAdjustmentReasonEnum.LOST,
	StockAdjustmentReasonEnum.THEFT,
	StockAdjustmentReasonEnum.SAMPLE,
]);

/** Units moved in or out of one lot, signed - positive added, negative removed. */
export type LotTopUp = {
	grn_item_id: number;
	qty: number;
	unit_cost_base: number;
};

/**
 * Where added units go: into the lots that have room - what they arrived with less what they
 * hold - **newest receipt first**, so they take the most recent cost rather than reviving an old
 * one. A lot never goes above what it arrived with (`grn_item`'s own check), so `null` when the
 * room at this warehouse is smaller than what is added: those units have no lot to belong to, and
 * have to come in on a receipt with a cost of their own.
 */
export function planTopUp(
	lots: readonly SiteLot[],
	surplus: number,
): LotTopUp[] | null {
	let left = surplus;
	const pieces: LotTopUp[] = [];

	for (const lot of [...lots].reverse()) {
		if (left <= 0) {
			break;
		}

		const room = roundMoney(lot.qty - lot.qty_remaining);

		if (room <= 0) {
			continue;
		}

		const added = Math.min(room, left);

		pieces.push({
			grn_item_id: lot.grn_item_id,
			qty: roundMoney(added),
			unit_cost_base: lot.unit_cost_base,
		});

		left = roundMoney(left - added);
	}

	return left > 0 ? null : pieces;
}

/**
 * Stock changed by hand - units added or removed for a stated reason - and undoing it.
 *
 * Every operation is one transaction that moves the lots (`grn_item.qty_remaining`, the
 * authoritative on-hand figure) and posts the ledger rows saying so, both through `grnService` -
 * the lot locks are the ones a shipment takes, in the same order, so a removal racing a shipment
 * of the same goods waits for it instead of drawing the same units twice.
 *
 * Reservations are left alone on purpose. A removal records a fact about the shelf; if it leaves a
 * variant promised beyond what it holds, the stock window says so (`available < 0`) and the cart
 * and checkout refuse on their own - refusing the removal would only keep broken goods on the
 * books.
 */
export class StockAdjustmentService {
	constructor(
		private repository: ReturnType<typeof getStockAdjustmentRepository>,
	) {}

	/**
	 * @description Used in `create` method from controller
	 *
	 * Removing draws oldest lot first - the draw a shipment makes - and refuses with 409 when the
	 * warehouse holds fewer. Adding tops up lots with room (`planTopUp`), 409 past that room. Either
	 * way one movement per lot touched, at that lot's cost, so the change can be valued.
	 */
	public async create(
		data: ValidatorOutput<StockAdjustmentValidator, 'create'>,
	): Promise<StockAdjustmentEntity> {
		const id = await dataSource.transaction((manager) =>
			this.createWithin(manager, data),
		);

		return this.findById(id);
	}

	/** `create` inside the caller's transaction - public for the demo seed. Returns the new id. */
	public async createWithin(
		manager: EntityManager,
		data: ValidatorOutput<StockAdjustmentValidator, 'create'>,
	): Promise<number> {
		await this.assertTarget(manager, data.warehouse_id, data.variant_id);

		const isRemoval =
			data.direction === StockAdjustmentDirectionEnum.REMOVE;

		const pieces = isRemoval
			? await this.drawLots(manager, data)
			: await this.topUpLots(manager, data);

		const adjustment = await manager.save(
			manager.create(StockAdjustmentEntity, {
				reason: data.reason,
				qty: isRemoval ? -data.qty : data.qty,
				status: StockAdjustmentStatusEnum.CREATED,
				reversed_at: null,
				notes: data.notes ?? null,
				warehouse_id: data.warehouse_id,
				variant_id: data.variant_id,
			}),
		);

		await this.postMovements(
			manager,
			adjustment,
			isRemoval && LOSS_REASONS.has(data.reason)
				? WarehouseMovementTypeEnum.WRITE_OFF
				: WarehouseMovementTypeEnum.ADJUSTMENT,
			pieces,
		);

		return adjustment.id;
	}

	private async drawLots(
		manager: EntityManager,
		data: ValidatorOutput<StockAdjustmentValidator, 'create'>,
	): Promise<LotTopUp[]> {
		const drawn = await grnService.consumeLots(manager, data.warehouse_id, [
			{ key: 0, variant_id: data.variant_id, quantity: data.qty },
		]);

		return drawn.map((piece) => ({
			grn_item_id: piece.grn_item_id,
			qty: -piece.qty,
			unit_cost_base: piece.unit_cost_base,
		}));
	}

	private async topUpLots(
		manager: EntityManager,
		data: ValidatorOutput<StockAdjustmentValidator, 'create'>,
	): Promise<LotTopUp[]> {
		const lots = await grnService.lockSiteLots(
			manager,
			data.warehouse_id,
			data.variant_id,
		);

		const planned = planTopUp(lots, data.qty);

		if (!planned) {
			throw new CustomError(
				409,
				lang('warehouse-movement.error.no_room_for_surplus', {
					surplus: String(data.qty),
					room: String(
						roundMoney(
							lots.reduce(
								(sum, lot) =>
									sum + (lot.qty - lot.qty_remaining),
								0,
							),
						),
					),
				}),
			);
		}

		await grnService.restoreLots(manager, planned);

		return planned;
	}

	/**
	 * @description Used in `reverse` method from controller
	 *
	 * Undoes an adjustment: one opposing `adjustment` movement per original row, with
	 * `reversal_of_id` set (the unique index on it is the second guard against undoing twice), and
	 * the units back where they were - removed units restored to the lots they left, added units
	 * taken back out of the lots they went into. The latter is refused with 409 when a lot no longer
	 * holds them; the stock has moved on, and a fresh count is the honest correction.
	 *
	 * Locked on the adjustment row first, then the lots, so two reversals of the same row queue on
	 * the row and the second finds it `reversed`.
	 */
	public async reverse(id: number): Promise<StockAdjustmentEntity> {
		await dataSource.transaction(async (manager) => {
			const adjustment = await manager
				.getRepository(StockAdjustmentEntity)
				.findOne({
					where: { id: id },
					lock: { mode: 'pessimistic_write' },
				});

			if (!adjustment) {
				throw new NotFoundError(
					lang('warehouse-movement.error.adjustment_not_found'),
				);
			}

			// Said in its own words: the shared transition check reads reversed -> reversed as "no
			// change" (400), when what happened is a second undo of something already undone
			if (adjustment.status === StockAdjustmentStatusEnum.REVERSED) {
				throw new CustomError(
					409,
					lang('warehouse-movement.error.adjustment_reversed'),
				);
			}

			assertValidStatusTransition(
				STATUS_TRANSITIONS,
				adjustment.status,
				StockAdjustmentStatusEnum.REVERSED,
			);

			const originals = await manager
				.getRepository(WarehouseMovementEntity)
				.find({
					where: {
						source_type: WarehouseMovementSourceEnum.ADJUSTMENT,
						source_id: adjustment.id,
						reversal_of_id: IsNull(),
					},
					order: { id: 'ASC' },
				});

			const lotPieces = originals.flatMap((row) =>
				row.grn_item_id === null
					? []
					: [
							{
								grn_item_id: row.grn_item_id,
								qty: Math.abs(row.qty),
							},
						],
			);

			if (adjustment.qty < 0) {
				await grnService.restoreLots(manager, lotPieces);
			} else {
				await grnService.withdrawFromLots(manager, lotPieces);
			}

			const occurredAt = new Date();

			if (originals.length > 0) {
				await manager.save(
					originals.map((row) =>
						manager.create(WarehouseMovementEntity, {
							movement_type: WarehouseMovementTypeEnum.ADJUSTMENT,
							qty: -row.qty,
							unit_cost_base: row.unit_cost_base,
							source_type: WarehouseMovementSourceEnum.ADJUSTMENT,
							source_id: adjustment.id,
							occurred_at: occurredAt,
							warehouse_id: row.warehouse_id,
							variant_id: row.variant_id,
							grn_item_id: row.grn_item_id,
							reversal_of_id: row.id,
							notes: null,
						}),
					),
				);
			}

			await manager.update(
				StockAdjustmentEntity,
				{ id: adjustment.id },
				{
					status: StockAdjustmentStatusEnum.REVERSED,
					reversed_at: occurredAt,
				},
			);
		});

		return this.findById(id);
	}

	/**
	 * The warehouse has to be active - an inactive site's lots are left out of on-hand, so a count
	 * there would be measured against a figure nothing else reads - and the variant has to track
	 * stock, since an untracked one has no lots to change.
	 */
	private async assertTarget(
		manager: EntityManager,
		warehouseId: number,
		variantId: number,
	): Promise<void> {
		const [warehouse, variant] = await Promise.all([
			manager.getRepository(WarehouseEntity).findOne({
				select: { id: true, status: true },
				where: { id: warehouseId },
			}),
			manager.getRepository(ProductVariantEntity).findOne({
				select: { id: true, track_stock: true },
				where: { id: variantId },
			}),
		]);

		if (!warehouse) {
			throw new NotFoundError(
				lang('warehouse-movement.error.warehouse_not_found', {
					warehouse_id: String(warehouseId),
				}),
			);
		}

		if (warehouse.status !== WarehouseStatusEnum.ACTIVE) {
			throw new CustomError(
				422,
				lang('warehouse-movement.error.warehouse_inactive', {
					warehouse_id: String(warehouseId),
				}),
			);
		}

		if (!variant) {
			throw new NotFoundError(
				lang('warehouse-movement.error.variant_not_found', {
					variant_id: String(variantId),
				}),
			);
		}

		if (!variant.track_stock) {
			throw new CustomError(
				422,
				lang('warehouse-movement.error.variant_untracked', {
					variant_id: String(variantId),
				}),
			);
		}
	}

	private async postMovements(
		manager: EntityManager,
		adjustment: StockAdjustmentEntity,
		movementType: WarehouseMovementType,
		pieces: readonly LotTopUp[],
	): Promise<void> {
		if (pieces.length === 0) {
			return;
		}

		const occurredAt = new Date();

		await manager.save(
			pieces.map((piece) =>
				manager.create(WarehouseMovementEntity, {
					movement_type: movementType,
					qty: piece.qty,
					unit_cost_base: piece.unit_cost_base,
					source_type: WarehouseMovementSourceEnum.ADJUSTMENT,
					source_id: adjustment.id,
					occurred_at: occurredAt,
					warehouse_id: adjustment.warehouse_id,
					variant_id: adjustment.variant_id,
					grn_item_id: piece.grn_item_id,
					reversal_of_id: null,
					notes: null,
				}),
			),
		);
	}

	private createListQuery() {
		return this.repository
			.createQuery()
			.select([
				...ENTRY_COLUMNS,
				...WAREHOUSE_COLUMNS,
				...VARIANT_COLUMNS,
			])
			.join('stock_adjustment.warehouse', 'warehouse', 'LEFT')
			.join('stock_adjustment.variant', 'variant', 'LEFT');
	}

	/**
	 * @description Used in `read` method from controller, and after every write
	 *
	 * The adjustment with the movements it posted and, once reversed, the ones that undid it -
	 * oldest first, so a reversal follows what it cancels.
	 */
	public async findById(
		id: number,
	): Promise<
		StockAdjustmentEntity & { movements: WarehouseMovementEntity[] }
	> {
		const entry = await this.createListQuery().filterById(id).firstOrFail();

		const movements = await dataSource
			.getRepository(WarehouseMovementEntity)
			.find({
				where: {
					source_type: WarehouseMovementSourceEnum.ADJUSTMENT,
					source_id: id,
				},
				order: { id: 'ASC' },
			});

		return Object.assign(entry, { movements: movements });
	}

	/** @description Used in `find` method from controller */
	public findByFilter(
		data: ValidatorOutput<StockAdjustmentValidator, 'find'>,
	) {
		const query = this.createListQuery();

		// The direction is the sign of `qty`; both conditions are fixed text, nothing interpolated
		if (data.filter.adjustment_direction) {
			query.filterRaw(
				data.filter.adjustment_direction ===
					StockAdjustmentDirectionEnum.ADD
					? 'stock_adjustment.qty > 0'
					: 'stock_adjustment.qty < 0',
			);
		}

		return query
			.filterBy('warehouse_id', data.filter.warehouse_id)
			.filterBy('variant_id', data.filter.variant_id)
			.filterBy('reason', data.filter.reason)
			.filterBy('status', data.filter.status)
			.filterByRange(
				'created_at',
				data.filter.created_at_start,
				data.filter.created_at_end,
			)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const stockAdjustmentService = new StockAdjustmentService(
	getStockAdjustmentRepository(),
);
