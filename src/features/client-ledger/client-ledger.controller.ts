import type { Request, Response } from 'express';
import {
	type ClientLedgerPolicy,
	clientLedgerPolicy,
} from '@/features/client-ledger/client-ledger.policy';
import {
	type ClientLedgerService,
	clientLedgerService,
} from '@/features/client-ledger/client-ledger.service';
import { ClientLedgerValidator } from '@/features/client-ledger/client-ledger.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

class ClientLedgerController extends BaseController {
	constructor(
		private policy: ClientLedgerPolicy,
		private validator: ClientLedgerValidator,
		private clientLedgerService: ClientLedgerService,
	) {
		super();
	}

	/**
	 * The money moved with the client, one row per currency. Not cached: every completed movement
	 * changes it, and a stale figure is exactly the one nobody should act on.
	 */
	public balance = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.balance, req.params, res);

		const balances = await this.clientLedgerService.getBalance(
			data.client_id,
		);

		res.locals.output.data({
			client_id: data.client_id,
			balances: balances,
		});

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(
			this.validator.find,
			{
				...req.query,
				filter: {
					...(typeof req.query.filter === 'object'
						? req.query.filter
						: {}),
					client_id: req.params.client_id,
				},
			},
			res,
		);

		const [entries, total] =
			await this.clientLedgerService.findByFilter(data);

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

export const clientLedgerController = new ClientLedgerController(
	clientLedgerPolicy,
	new ClientLedgerValidator('client-ledger'),
	clientLedgerService,
);
