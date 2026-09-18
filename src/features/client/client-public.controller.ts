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
import { ClientValidator } from '@/features/client/client.validator';
import asyncHandler from '@/helpers/async.handler';
import { getRouteParam } from '@/helpers/request.helper';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The shopper's own clients - who an order may be billed to. No permission is checked, but an
 * account is: every row here is scoped to the account behind the request, and that account is
 * what a created client is linked to.
 */
class ClientPublicController extends BaseController {
	constructor(
		private policy: ClientPolicy,
		private validator: ClientValidator,
		private clientService: ClientService,
	) {
		super();
	}

	/**
	 * Who the request counts as. `requiredAuth` has already rejected a caller with no account, so
	 * the id is present - the `?? 0` never fires and only satisfies the optional return type of
	 * `getId`.
	 */
	private resolveOwner(res: Response): number {
		this.policy.requiredAuth(res.locals.auth);

		return this.policy.getId(res.locals.auth) ?? 0;
	}

	public find = asyncHandler(async (_req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const entries = await this.clientService.findOwn(userId);

		res.locals.output.data({
			entries: entries,
		});

		res.json(res.locals.output);
	});

	public create = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const data = this.validate(this.validator.publicCreate, req.body, res);

		const entry = await this.clientService.create(data, userId);

		res.locals.output.data(entry);
		res.locals.output.message(lang('client.success.create'));

		res.status(201).json(res.locals.output);
	});

	/**
	 * The row is resolved before validation for the same reason the dashboard update does it:
	 * `client_type` discriminates the schema and may be absent from the body. Resolving it through
	 * `findOwnById` also makes that read the ownership check - somebody else's id is a 404.
	 */
	public update = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const existingEntry = await this.clientService.findOwnById(
			parseInt(getRouteParam(req, 'id') ?? '', 10),
			userId,
		);

		const data = this.validate(
			this.validator.publicUpdate,
			{
				client_type: req.body.client_type ?? existingEntry.client_type,
				...req.body,
			},
			res,
		);

		const entry = await this.clientService.updateData(existingEntry, data);

		res.locals.output.message(lang('client.success.update'));
		res.locals.output.data(entry);

		res.json(res.locals.output);
	});
}

export const clientPublicController = new ClientPublicController(
	clientPolicy,
	new ClientValidator('client'),
	clientService,
);
