import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import OrderReturnEntity from '@/features/order-return/order-return.entity';
import {
	type OrderReturnPolicy,
	orderReturnPolicy,
} from '@/features/order-return/order-return.policy';
import {
	type OrderReturnService,
	orderReturnService,
} from '@/features/order-return/order-return.service';
import { OrderReturnValidator } from '@/features/order-return/order-return.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Return authorizations, back office. Every action is gated through `OrderReturnPolicy` on the
 * `order-return` permissions: an operator raises a return for a client, decides on requests,
 * and re-drafts a refund when the automatic one could not be raised.
 *
 * `approve` writes the return movement and `refund` drafts reversals, so both are `update`
 * actions - they change the return, and through it the documents it drives.
 */
class OrderReturnController extends BaseController {
	constructor(
		private policy: OrderReturnPolicy,
		private validator: OrderReturnValidator,
		private cache: CacheProvider,
		private orderReturnService: OrderReturnService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.orderReturnService.create(data, {
			userId: null,
			enforceWindow: false,
		});

		res.locals.output.data(entry);
		res.locals.output.message(lang('order-return.success.create'));

		res.status(201).json(res.locals.output);
	});

	public returnable = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.returnable, req.params, res);

		res.locals.output.data(
			await this.orderReturnService.getReturnable(data.order_id),
		);

		res.json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			OrderReturnEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.orderReturnService.getEntryData({
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

		const existingEntry = await this.orderReturnService.findById(
			data.id,
			false,
		);

		const entry = await this.orderReturnService.updateData(
			existingEntry,
			data,
		);

		res.locals.output.message(lang('order-return.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.orderReturnService.delete(data.id);

		res.locals.output.message(lang('order-return.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.orderReturnService.restore(data.id);

		res.locals.output.message(lang('order-return.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.orderReturnService.findByFilter(
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

	public approve = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.approve,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const existingEntry = await this.orderReturnService.findById(
			data.id,
			false,
		);

		const entry = await this.orderReturnService.approve(
			existingEntry,
			data,
		);

		res.locals.output.message(lang('order-return.success.approve'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public refund = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(this.validator.refund, req.params, res);

		const ids = await this.orderReturnService.draftRefund(data.id);

		if (ids.length === 0) {
			throw new CustomError(
				409,
				lang('order-return.error.nothing_to_refund'),
			);
		}

		res.locals.output.message(lang('order-return.success.refund'));
		res.locals.output.data({ reversal_invoice_ids: ids });

		res.json(res.locals.output);
	});

	public statusUpdate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.statusUpdate,
			{
				...req.body,
				...req.params,
			},
			res,
		);

		const existingEntry = await this.orderReturnService.findById(
			data.id,
			false,
		);

		await this.orderReturnService.updateStatus(
			existingEntry,
			data.status,
			data.response,
		);

		res.locals.output.message(lang('order-return.success.status_update'));

		res.json(res.locals.output);
	});
}

export const orderReturnController = new OrderReturnController(
	orderReturnPolicy,
	new OrderReturnValidator('order-return'),
	cacheProvider,
	orderReturnService,
);
