import type { Request, Response } from 'express';

import { lang } from '@/config/message.setup';
import ClientEntity from '@/features/client/client.entity';
import {
	type ClientPolicy,
	clientPolicy,
} from '@/features/client/client.policy';
import {
	type ClientService,
	clientService,
} from '@/features/client/client.service';
import { ClientValidator } from '@/features/client/client.validator';
import asyncHandler from '@/helpers/async.handler';
import { getRouteParam } from '@/helpers/request.helper';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class ClientController extends BaseController {
	constructor(
		private policy: ClientPolicy,
		private validator: ClientValidator,
		private cache: CacheProvider,
		private clientService: ClientService,
	) {
		super();
	}
	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canCreate(res.locals.auth);

		const data = this.validate(this.validator.create, req.body, res);

		const entry = await this.clientService.create(data);

		res.locals.output.data(entry);
		res.locals.output.message(lang('client.success.create'));

		res.status(201).json(res.locals.output);
	});

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const withDeleted = this.policy.allowDeleted(res.locals.auth);

		const cacheKey = this.cache.buildKey(
			ClientEntity.NAME,
			data.id.toString(),
			withDeleted ? 'with-deleted' : 'non-deleted',
			'read',
		);

		const cacheGetResults = await this.cache.get(cacheKey, () =>
			this.clientService.getEntryData({
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

		/*
		 * The id is read straight from the route: `validateParamsWhenId('id')` has already
		 * rejected anything that is not a positive integer. It is needed before validation
		 * because `client_type` discriminates the update union and may be absent from the
		 * body, so the stored value has to fill in for it.
		 */
		const existingEntry = await this.clientService.findById(
			parseInt(getRouteParam(req, 'id') ?? '', 10),
			false,
		);

		const data = this.validate(
			this.validator.update,
			{
				client_type: req.body.client_type ?? existingEntry.client_type, // Because `client_type` is not required but needed for validation
				...req.body, // client_type (DB value will be overwritten by the one in the body if it exists)
			},
			res,
		);

		const entry = await this.clientService.updateData(existingEntry, data);

		res.locals.output.message(lang('client.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.clientService.delete(data.id);

		res.locals.output.message(lang('client.success.delete'));

		res.json(res.locals.output);
	});

	public restore = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRestore(res.locals.auth);

		const data = this.validate(this.validator.restore, req.params, res);

		await this.clientService.restore(data.id);

		res.locals.output.message(lang('client.success.restore'));

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.clientService.findByFilter(
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

	/**
	 * Links the client to an account, or unlinks it when the body carries `user_id: null`.
	 *
	 * An action of its own rather than a field on `update`: the link is what lets a shopper bill an
	 * order to this client and what makes a review count as a verified purchase, so it is granted
	 * deliberately instead of riding along with an edit of the contact details.
	 */
	public updateAccount = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.updateAccount,
			{ ...req.body, id: req.params.id },
			res,
		);

		const existingEntry = await this.clientService.findById(data.id, false);

		if (existingEntry.user_id !== data.user_id) {
			await this.clientService.updateAccount(existingEntry, data.user_id);
		}

		res.locals.output.message(
			lang(
				data.user_id === null
					? 'client.success.unlink_account'
					: 'client.success.link_account',
			),
		);

		res.json(res.locals.output);
	});

	public statusUpdate = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canUpdate(res.locals.auth);

		const data = this.validate(
			this.validator.statusUpdate,
			req.params,
			res,
		);

		const existingEntry = await this.clientService.findById(data.id, false);

		await this.clientService.updateStatus(existingEntry, data.status);

		res.locals.output.message(lang('client.success.status_update'));

		res.json(res.locals.output);
	});
}

export const clientController = new ClientController(
	clientPolicy,
	new ClientValidator('client'),
	cacheProvider,
	clientService,
);
