import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import ClientAddressEntity from '@/features/client-address/client-address.entity';
import {
	type ClientAddressPolicy,
	clientAddressPolicy,
} from '@/features/client-address/client-address.policy';
import {
	type ClientAddressService,
	clientAddressService,
} from '@/features/client-address/client-address.service';
import { ClientAddressValidator } from '@/features/client-address/client-address.validator';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * No `restore` and no status: a client address is deleted outright (the table has no
 * `deleted_at`), so there is neither a deleted row to bring back nor a `with-deleted` read.
 */
class ClientAddressController extends BaseController {
	constructor(
		private policy: ClientAddressPolicy,
		private validator: ClientAddressValidator,
		private cache: CacheProvider,
		private clientAddressService: ClientAddressService,
	) {
		super();
	}

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.clientAddressService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('client-address.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(
			this.validator.read,
			{
				...req.query,
				id: req.params.id,
			},
			res,
		);

		const language = data.language ?? res.locals.language;

		const cacheKey = this.cache.buildKey(
			ClientAddressEntity.NAME,
			data.id.toString(),
			language,
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.clientAddressService.getEntryData({
				id: data.id,
				language,
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

		const existingEntry = await this.clientAddressService.findById(data.id);

		const entry = await this.clientAddressService.updateData(
			existingEntry,
			data,
		);

		res.locals.output.message(lang('client-address.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.clientAddressService.delete(data.id);

		res.locals.output.message(lang('client-address.success.delete'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		if (!data.filter.language) {
			data.filter.language = res.locals.language;
		}

		const [entries, total] =
			await this.clientAddressService.findByFilter(data);

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

export const clientAddressController = new ClientAddressController(
	clientAddressPolicy,
	new ClientAddressValidator('client-address'),
	cacheProvider,
	clientAddressService,
);
