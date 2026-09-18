import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import OrderEntity from '@/features/order/order.entity';
import { type OrderPolicy, orderPolicy } from '@/features/order/order.policy';
import {
	type OrderService,
	orderService,
} from '@/features/order/order.service';
import { OrderValidator } from '@/features/order/order.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The back office's view of the order book: compose a document, follow it through its lifecycle,
 * and look up what was agreed.
 *
 * There is no public counterpart yet. What a storefront shows after checkout is the cart's
 * confirmation; an account's order history would be scoped through `client.user_id`, the same link
 * checkout and review verification read.
 */
class OrderController extends BaseController {
	constructor(
		private policy: OrderPolicy,
		private validator: OrderValidator,
		private cache: CacheProvider,
		private orderService: OrderService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.orderService.createEntry(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('order.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			OrderEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.orderService.getEntryData({
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

		const existingEntry = await this.orderService.findById(data.id, false);

		const entry = await this.orderService.updateData(existingEntry, data);

		res.locals.output.message(lang('order.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.orderService.delete(data.id);

		res.locals.output.message(lang('order.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.orderService.restore(data.id);

		res.locals.output.message(lang('order.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.orderService.findByFilter(
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

		const existingEntry = await this.orderService.findById(data.id, false);

		await this.orderService.updateStatus(existingEntry, data.status);

		res.locals.output.message(lang('order.success.status_update'));

		res.json(res.locals.output);
	});
}

export const orderController = new OrderController(
	orderPolicy,
	new OrderValidator('order'),
	cacheProvider,
	orderService,
);
