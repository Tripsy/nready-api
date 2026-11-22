import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
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
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Returns for the buyer: ask to send back goods from one of the account's own orders, follow the
 * request, and withdraw it while it is undecided. No permission is checked, but an account is, and
 * the order has to be billed to one of its clients - every action resolves it first
 * (`OrderService.findOwnById`, 404 otherwise).
 *
 * The order comes from the path and is spread last, so a body naming another order cannot redirect
 * the write.
 */
class OrderReturnPublicController extends BaseController {
	constructor(
		private policy: OrderReturnPolicy,
		private validator: OrderReturnValidator,
		private orderReturnService: OrderReturnService,
	) {
		super();
	}

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.publicFind, req.params, res);

		const entries = await this.orderReturnService.findForOwnOrder(
			data.order_id,
			this.policy.getId(res.locals.auth) ?? 0,
		);

		res.locals.output.data({
			entries: entries,
		});

		res.json(res.locals.output);
	});

	public returnable = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.publicFind, req.params, res);

		res.locals.output.data(
			await this.orderReturnService.getOwnReturnable(
				data.order_id,
				this.policy.getId(res.locals.auth) ?? 0,
			),
		);

		res.json(res.locals.output);
	});

	public create = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(
			this.validator.publicCreate,
			{
				...req.body,
				order_id: req.params.order_id,
			},
			res,
		);

		const entry = await this.orderReturnService.createOwn(
			data,
			this.policy.getId(res.locals.auth) ?? 0,
		);

		res.locals.output.data({
			id: entry.id,
			ref_code: entry.ref_code,
			ref_number: entry.ref_number,
			status: entry.status,
		});
		res.locals.output.message(lang('order-return.success.request'));

		res.status(201).json(res.locals.output);
	});

	public cancel = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(
			this.validator.publicCancel,
			req.params,
			res,
		);

		await this.orderReturnService.cancelOwn(
			data.order_id,
			data.id,
			this.policy.getId(res.locals.auth) ?? 0,
		);

		res.locals.output.message(lang('order-return.success.cancel'));

		res.json(res.locals.output);
	});
}

export const orderReturnPublicController = new OrderReturnPublicController(
	orderReturnPolicy,
	new OrderReturnValidator('order-return'),
	orderReturnService,
);
