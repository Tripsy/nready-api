import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import VatRateEntity from '@/features/vat-rate/vat-rate.entity';
import {
	type VatRatePolicy,
	vatRatePolicy,
} from '@/features/vat-rate/vat-rate.policy';
import {
	type VatRateService,
	vatRateService,
} from '@/features/vat-rate/vat-rate.service';
import { VatRateValidator } from '@/features/vat-rate/vat-rate.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class VatRateController extends BaseController {
	constructor(
		private policy: VatRatePolicy,
		private validator: VatRateValidator,
		private cache: CacheProvider,
		private vatRateService: VatRateService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.vatRateService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('vat-rate.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const cacheKey = this.cache.buildKey(
			VatRateEntity.NAME,
			data.id.toString(),
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.vatRateService.getEntryData({ id: data.id }),
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

		const existingEntry = await this.vatRateService.findById(data.id);

		const entry = await this.vatRateService.updateData(existingEntry, data);

		res.locals.output.message(lang('vat-rate.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.vatRateService.delete(data.id);

		res.locals.output.message(lang('vat-rate.success.delete'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.vatRateService.findByFilter(data);

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

export const vatRateController = new VatRateController(
	vatRatePolicy,
	new VatRateValidator('vat-rate'),
	cacheProvider,
	vatRateService,
);
