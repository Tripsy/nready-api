import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import ShippingEntity from '@/features/shipping/shipping.entity';
import {
	type ShippingPolicy,
	shippingPolicy,
} from '@/features/shipping/shipping.policy';
import {
	type ShippingService,
	shippingService,
} from '@/features/shipping/shipping.service';
import { ShippingValidator } from '@/features/shipping/shipping.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The back office's view of what is on its way: which parcel carries which part of an order, where
 * it leaves from, and how far along it is.
 *
 * There is no public counterpart. What a shopper is told about delivery comes from the order, and a
 * storefront view of shipments would be scoped through `client.user_id` the way checkout is.
 */
class ShippingController extends BaseController {
	constructor(
		private policy: ShippingPolicy,
		private validator: ShippingValidator,
		private cache: CacheProvider,
		private shippingService: ShippingService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.shippingService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('shipping.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			ShippingEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.shippingService.getEntryData({
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

		const existingEntry = await this.shippingService.findById(
			data.id,
			false,
		);

		const entry = await this.shippingService.updateData(
			existingEntry,
			data,
		);

		res.locals.output.message(lang('shipping.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.shippingService.delete(data.id);

		res.locals.output.message(lang('shipping.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.shippingService.restore(data.id);

		res.locals.output.message(lang('shipping.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.shippingService.findByFilter(
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

		const existingEntry = await this.shippingService.findById(
			data.id,
			false,
		);

		await this.shippingService.updateStatus(existingEntry, data.status);

		res.locals.output.message(lang('shipping.success.status_update'));

		res.json(res.locals.output);
	});
}

export const shippingController = new ShippingController(
	shippingPolicy,
	new ShippingValidator('shipping'),
	cacheProvider,
	shippingService,
);
