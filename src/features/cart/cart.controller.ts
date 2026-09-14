import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import { type CartPolicy, cartPolicy } from '@/features/cart/cart.policy';
import { type CartService, cartService } from '@/features/cart/cart.service';
import { CartValidator } from '@/features/cart/cart.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The dashboard side: look at what shoppers are carrying, and take a cart away when support has to.
 *
 * No `create` and no `update`. A cart is the shopper's own working state, and a back office able
 * to edit one would be changing the record of what they chose - the order is where the business
 * takes over, and that is a separate document.
 */
class CartController extends BaseController {
	constructor(
		private policy: CartPolicy,
		private validator: CartValidator,
		private cartService: CartService,
	) {
		super();
	}

	public read = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canRead(res.locals.auth);

		const data = this.validate(this.validator.read, req.params, res);

		const entry = await this.cartService.getEntryData({ id: data.id });

		res.locals.output.data(entry);

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canFind(res.locals.auth);

		const data = this.validate(this.validator.find, req.query, res);

		const [entries, total] = await this.cartService.findByFilter(data);

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

	public delete = asyncHandler(async (req: Request, res: Response) => {
		this.policy.canDelete(res.locals.auth);

		const data = this.validate(this.validator.delete, req.params, res);

		await this.cartService.delete(data.id);

		res.locals.output.message(lang('cart.success.delete'));

		res.json(res.locals.output);
	});
}

export const cartController = new CartController(
	cartPolicy,
	new CartValidator('cart'),
	cartService,
);
