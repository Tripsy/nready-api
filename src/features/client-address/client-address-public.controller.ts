import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import {
	type ClientPolicy,
	clientPolicy,
} from '@/features/client/client.policy';
import {
	type ClientService,
	clientService,
} from '@/features/client/client.service';
import {
	type ClientAddressService,
	clientAddressService,
} from '@/features/client-address/client-address.service';
import { ClientAddressValidator } from '@/features/client-address/client-address.validator';
import asyncHandler from '@/helpers/async.handler';
import { getRouteParam } from '@/helpers/request.helper';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The shopper's own billing and delivery addresses, filed under one of their clients.
 *
 * No permission, but an account: every row is reached through a client the account holds. A list
 * or a create names the client and `ClientService.findOwnById` proves it; an `/:id` route resolves
 * the address joined to its client's owner in the same query. Somebody else's row answers the same
 * 404 a missing one does, so the caller learns nothing about ids they cannot use.
 *
 * A create answers with the address as `find` lists it - place names resolved - so the page can
 * add the row without a second read. There is no update: an address is added or removed, since
 * the linked `address` row may be shared with other clients.
 */
class ClientAddressPublicController extends BaseController {
	constructor(
		private policy: ClientPolicy,
		private validator: ClientAddressValidator,
		private clientService: ClientService,
		private clientAddressService: ClientAddressService,
	) {
		super();
	}

	/** See `ClientPublicController.resolveOwner` - the `?? 0` never fires after `requiredAuth`. */
	private resolveOwner(res: Response): number {
		this.policy.requiredAuth(res.locals.auth);

		return this.policy.getId(res.locals.auth) ?? 0;
	}

	private async findOwnEntry(req: Request, userId: number) {
		return this.clientAddressService.findOwnById(
			parseInt(getRouteParam(req, 'id') ?? '', 10),
			userId,
		);
	}

	public find = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const data = this.validate(this.validator.publicFind, req.query, res);

		await this.clientService.findOwnById(data.client_id, userId);

		const entries = await this.clientAddressService.findOwn(
			data.client_id,
			data.type,
			res.locals.language,
		);

		res.locals.output.data({
			entries: entries,
		});

		res.json(res.locals.output);
	});

	public create = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const data = this.validate(this.validator.publicCreate, req.body, res);

		await this.clientService.findOwnById(data.client_id, userId);

		const entry = await this.clientAddressService.createOwn(data);

		res.locals.output.data(
			await this.clientAddressService.getOwnEntry(
				entry.id,
				res.locals.language,
			),
		);
		res.locals.output.message(lang('client-address.success.create'));

		res.status(201).json(res.locals.output);
	});

	public delete = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const existingEntry = await this.findOwnEntry(req, userId);

		await this.clientAddressService.delete(existingEntry.id);

		res.locals.output.message(lang('client-address.success.delete'));

		res.json(res.locals.output);
	});
}

export const clientAddressPublicController = new ClientAddressPublicController(
	clientPolicy,
	new ClientAddressValidator('client-address'),
	clientService,
	clientAddressService,
);
