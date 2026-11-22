import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import TemplateEntity from '@/features/template/template.entity';
import {
	type TemplatePolicy,
	templatePolicy,
} from '@/features/template/template.policy';
import {
	type TemplateService,
	templateService,
} from '@/features/template/template.service';
import { TemplateValidator } from '@/features/template/template.validator';
import asyncHandler from '@/helpers/async.handler';
import { getRouteParam } from '@/helpers/request.helper';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class TemplateController extends BaseController {
	constructor(
		private policy: TemplatePolicy,
		private validator: TemplateValidator,
		private cache: CacheProvider,
		private templateService: TemplateService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.templateService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('template.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			TemplateEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.templateService.findById(data.id, withDeleted),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});

	public update = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		/*
		 * The id is read straight from the route: `validateParamsWhenId('id')` has already
		 * rejected anything that is not a uuid. It is needed before validation
		 * because `type` discriminates the update union and may be absent from the body, so
		 * the stored value has to fill in for it.
		 */
		const existingEntry = await this.templateService.findById(
			getRouteParam(req, 'id') ?? '',
			false,
		);

		const data = this.validate(
			this.validator.update,
			{
				type: req.body.type ?? existingEntry.type, // Because `type` is not required but needed for validation
				...req.body, // type (DB value will be overwritten by the one in the body if it exists)
				id: existingEntry.id, // Required by the schema; the path wins over anything in the body
			},
			res,
		);

		const entry = await this.templateService.updateData(
			existingEntry,
			data,
		);

		res.locals.output.message(lang('template.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.templateService.delete(data.id);

		res.locals.output.message(lang('template.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.templateService.restore(data.id);

		res.locals.output.message(lang('template.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.templateService.findByFilter(
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

export const templateController = new TemplateController(
	templatePolicy,
	new TemplateValidator('template'),
	cacheProvider,
	templateService,
);
