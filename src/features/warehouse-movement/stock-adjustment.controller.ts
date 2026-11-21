import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import {
	type StockAdjustmentPolicy,
	stockAdjustmentPolicy,
} from '@/features/warehouse-movement/stock-adjustment.policy';
import {
	type StockAdjustmentService,
	stockAdjustmentService,
} from '@/features/warehouse-movement/stock-adjustment.service';
import { StockAdjustmentValidator } from '@/features/warehouse-movement/stock-adjustment.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Stock added or removed by hand. Nothing is cached: every row changes on-hand, and a reversal changes
 * the row itself, so a cached read would be wrong exactly when it is looked at.
 */
class StockAdjustmentController extends BaseController {
	constructor(
		private policy: StockAdjustmentPolicy,
		private validator: StockAdjustmentValidator,
		private stockAdjustmentService: StockAdjustmentService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.stockAdjustmentService.create(data);

		res.locals.output.message(lang('warehouse-movement.success.create'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public reverse = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.reverse, req.params, res);

		const entry = await this.stockAdjustmentService.reverse(data.id);

		res.locals.output.message(lang('warehouse-movement.success.reverse'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		res.locals.output.data(
			await this.stockAdjustmentService.findById(data.id),
		);

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] =
			await this.stockAdjustmentService.findByFilter(data);

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

// Messages live in the feature's own locale file - the namespace is the feature, not the entity
export const stockAdjustmentController = new StockAdjustmentController(
	stockAdjustmentPolicy,
	new StockAdjustmentValidator('warehouse-movement'),
	stockAdjustmentService,
);
