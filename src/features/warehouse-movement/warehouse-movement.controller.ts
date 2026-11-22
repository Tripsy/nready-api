import type { Request, Response } from 'express';
import {
	type StockReportService,
	stockReportService,
} from '@/features/warehouse-movement/stock-report.service';
import {
	type StockReservationService,
	stockReservationService,
} from '@/features/warehouse-movement/stock-reservation.service';
import WarehouseMovementEntity from '@/features/warehouse-movement/warehouse-movement.entity';
import {
	type WarehouseMovementPolicy,
	warehouseMovementPolicy,
} from '@/features/warehouse-movement/warehouse-movement.policy';
import {
	type WarehouseMovementService,
	warehouseMovementService,
} from '@/features/warehouse-movement/warehouse-movement.service';
import { WarehouseMovementValidator } from '@/features/warehouse-movement/warehouse-movement.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Read-only over stock: the ledger and the reservations are written by the documents that move or
 * promise goods, inside their own transactions, so there is no create, update or delete here.
 */
class WarehouseMovementController extends BaseController {
	constructor(
		private policy: WarehouseMovementPolicy,
		private validator: WarehouseMovementValidator,
		private cache: CacheProvider,
		private warehouseMovementService: WarehouseMovementService,
		private stockReservationService: StockReservationService,
		private stockReportService: StockReportService,
	) {
		super();
	}

	/**
	 * Tracked variants at or under their low-stock threshold, on available stock, lowest first.
	 * Gated as a `find` of the ledger; not cached, for the reason `stock` is not.
	 */
	public lowStock = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.lowStock, req.query, res);

		const [entries, total] = await this.stockReportService.findLowStock(
			data.page,
			data.limit,
		);

		res.locals.output.data({
			entries: entries,
			pagination: {
				page: data.page,
				limit: data.limit,
				total: total,
			},
			query: data,
		});

		res.json(res.locals.output);
	});

	/**
	 * A variant's stock: on hand per warehouse, reserved and available. Gated as a `read` of the
	 * ledger. Not cached - every receipt, order and cancel moves it, and a stale availability is
	 * exactly the figure nobody should act on.
	 */
	public stock = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.stock, req.params, res);

		res.locals.output.data(
			await this.stockReservationService.getVariantStock(data.variant_id),
		);

		res.json(res.locals.output);
	});

	/**
	 * Cached with no invalidation path, and safely so: a movement is never updated or deleted, so
	 * the cached copy cannot go stale.
	 */
	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const cacheKey = this.cache.buildKey(
			WarehouseMovementEntity.NAME,
			data.id.toString(),
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, async () =>
			this.warehouseMovementService.findById(data.id),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] =
			await this.warehouseMovementService.findByFilter(data);

		res.locals.output.data({
			entries: entries,
			pagination: {
				page: data.page,
				limit: data.limit,
				total: total,
			},
			query: data,
		});

		res.json(res.locals.output);
	});
}

export const warehouseMovementController = new WarehouseMovementController(
	warehouseMovementPolicy,
	new WarehouseMovementValidator('warehouse-movement'),
	cacheProvider,
	warehouseMovementService,
	stockReservationService,
	stockReportService,
);
