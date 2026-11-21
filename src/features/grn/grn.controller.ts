import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import GrnEntity from '@/features/grn/grn.entity';
import { type GrnPolicy, grnPolicy } from '@/features/grn/grn.policy';
import { type GrnService, grnService } from '@/features/grn/grn.service';
import { GrnValidator } from '@/features/grn/grn.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Goods received notes, back office only - receiving stock is an operator's act, and there is no
 * storefront view of it. Every action is gated through `GrnPolicy` on the `grn` permissions.
 *
 * `statusUpdate` is where stock moves: confirming opens the lots and posts the receipt movements,
 * canceling a confirmed receipt posts the reversals - see `GrnService`.
 */
class GrnController extends BaseController {
	constructor(
		private policy: GrnPolicy,
		private validator: GrnValidator,
		private cache: CacheProvider,
		private grnService: GrnService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.grnService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('grn.success.create'));

		res.status(201).json(res.locals.output);
	});

	/**
	 * Price rows whose floor is under the variant's cost, tightest first - the list the
	 * `cost-over-floor` cron mails. Gated as a `find` of receipts, which set that cost. Not
	 * cached: a receipt, a cancel or a price edit moves it, and a stale gap is the one figure
	 * this exists to make someone act on.
	 */
	public costOverFloor = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(
			this.validator.costOverFloor,
			req.query,
			res,
		);

		const [entries, total] = await this.grnService.findCostOverFloor(
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

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			GrnEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.grnService.getEntryData({
				id: data.id,
				withDeleted,
			}),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});

	public update = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.update,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const existingEntry = await this.grnService.findById(data.id, false);

		const entry = await this.grnService.updateData(existingEntry, data);

		res.locals.output.message(lang('grn.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.grnService.delete(data.id);

		res.locals.output.message(lang('grn.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.grnService.restore(data.id);

		res.locals.output.message(lang('grn.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.grnService.findByFilter(
			data,
			this.policy.allowDeleted(res.locals.auth),
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

	public statusUpdate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.statusUpdate,
			req.params,
			res,
		);

		const existingEntry = await this.grnService.findById(data.id, false);

		await this.grnService.updateStatus(existingEntry, data.status);

		res.locals.output.message(lang('grn.success.status_update'));

		res.json(res.locals.output);
	});
}

export const grnController = new GrnController(
	grnPolicy,
	new GrnValidator('grn'),
	cacheProvider,
	grnService,
);
