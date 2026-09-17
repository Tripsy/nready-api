import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import DiscountEntity from '@/features/discount/discount.entity';
import {
	type DiscountPolicy,
	discountPolicy,
} from '@/features/discount/discount.policy';
import {
	type DiscountService,
	discountService,
} from '@/features/discount/discount.service';
import { DiscountValidator } from '@/features/discount/discount.validator';
import {
	type DiscountTargetService,
	discountTargetService,
} from '@/features/discount/discount-target.service';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class DiscountController extends BaseController {
	constructor(
		private policy: DiscountPolicy,
		private validator: DiscountValidator,
		private cache: CacheProvider,
		private discountService: DiscountService,
		private targetService: DiscountTargetService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.discountService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('discount.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const cacheKey = this.cache.buildKey(
			DiscountEntity.NAME,
			data.id.toString(),
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, async () =>
			this.discountService.findById(
				data.id,
				this.policy.allowDeleted(res.locals.auth),
			),
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

		const existingEntry = await this.discountService.findById(
			data.id,
			false,
		);

		const entry = await this.discountService.updateData(
			existingEntry,
			data,
		);

		res.locals.output.message(lang('discount.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public readTargets = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		// Confirms the discount exists (and is not soft-deleted for this caller) before
		// reporting links, so a bad id answers 404 rather than an empty set.
		await this.discountService.findById(
			data.id,
			this.policy.allowDeleted(res.locals.auth),
		);

		res.locals.output.data(await this.targetService.listTargets(data.id));

		res.json(res.locals.output);
	});

	public updateTargets = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.targets,
			{
				...req.body,
				id: req.params.id,
			},
			res,
		);

		const discount = await this.discountService.findById(data.id, false);

		const { id, ...targets } = data;

		// Judged against the set as it will stand: a type absent from the body keeps its links
		this.targetService.assertTargetsFitScope(discount.scope, {
			...(await this.targetService.listTargets(id)),
			...targets,
		});

		res.locals.output.data(
			await this.targetService.replaceTargets(id, targets),
		);
		res.locals.output.message(lang('discount.success.targets'));

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.discountService.delete(data.id);

		res.locals.output.message(lang('discount.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.discountService.restore(data.id);

		res.locals.output.message(lang('discount.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.discountService.findByFilter(
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
}

export const discountController = new DiscountController(
	discountPolicy,
	new DiscountValidator('discount'),
	cacheProvider,
	discountService,
	discountTargetService,
);
