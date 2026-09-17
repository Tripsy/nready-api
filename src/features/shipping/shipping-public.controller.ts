import type { Request, Response } from 'express';
import {
	type ShippingPolicy,
	shippingPolicy,
} from '@/features/shipping/shipping.policy';
import {
	type ShippingService,
	shippingService,
} from '@/features/shipping/shipping.service';
import { ShippingValidator } from '@/features/shipping/shipping.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * Delivery tracking for the buyer: the movements of one of the account's own orders. No permission
 * is checked, but an account is, and the order has to be billed to one of its clients.
 *
 * Lives in `shipping` rather than beside `OrderPublicController` because the dependency runs this
 * way - `shipping` depends on `order`, and an order read that reached into shipments would invert it.
 */
class ShippingPublicController extends BaseController {
	constructor(
		private policy: ShippingPolicy,
		private validator: ShippingValidator,
		private shippingService: ShippingService,
	) {
		super();
	}

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.publicFind, req.params, res);

		const entries = await this.shippingService.findForOwnOrder(
			data.order_id,
			this.policy.getId(res.locals.auth) ?? 0,
		);

		res.locals.output.data({
			entries: entries,
		});

		res.json(res.locals.output);
	});
}

export const shippingPublicController = new ShippingPublicController(
	shippingPolicy,
	new ShippingValidator('shipping'),
	shippingService,
);
