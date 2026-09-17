import type { Request, Response } from 'express';
import { type OrderPolicy, orderPolicy } from '@/features/order/order.policy';
import {
	type OrderService,
	orderService,
} from '@/features/order/order.service';
import { OrderValidator } from '@/features/order/order.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The buyer's side of the order book: the account's own order history. No permission is checked,
 * but an account is - an order belongs to the account through `client.user_id`, the same link
 * checkout and review verification read, and every read here is scoped by it in the query itself.
 *
 * Read-only. What a buyer may still change about an order is nothing: the lines are adjusted by
 * the business while it is pending, and the status moves on the business's decisions.
 */
class OrderPublicController extends BaseController {
	constructor(
		private policy: OrderPolicy,
		private validator: OrderValidator,
		private orderService: OrderService,
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

	public find = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const data = this.validate(this.validator.publicFind, req.query, res);

		const [entries, total] = await this.orderService.findOwnByFilter(
			data,
			userId,
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

	public read = asyncHandler(async (req: Request, res: Response) => {
		const userId = this.resolveOwner(res);

		const data = this.validate(this.validator.read, req.params, res);

		const entry = await this.orderService.getOwnEntryData(data.id, userId);

		res.locals.output.data(entry);

		res.json(res.locals.output);
	});
}

export const orderPublicController = new OrderPublicController(
	orderPolicy,
	new OrderValidator('order'),
	orderService,
);
