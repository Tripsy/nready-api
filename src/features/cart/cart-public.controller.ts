import type { Request, Response } from 'express';
import { lang } from '@/config/message.setup';
import type CartEntity from '@/features/cart/cart.entity';
import { type CartPolicy, cartPolicy } from '@/features/cart/cart.policy';
import { type CartService, cartService } from '@/features/cart/cart.service';
import { CartValidator } from '@/features/cart/cart.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/** The header a client returns its cart handle in. */
export const CART_TOKEN_HEADER = 'x-cart-token';

/**
 * The storefront surface. No permission is checked and no account is required - a guest filling a
 * basket is the case this feature exists for.
 *
 * Authorization is the token: `CartService.findWritable` addresses a cart by the handle alone, so a
 * caller reaches exactly the cart they hold the handle for and nothing else - and a cart that has
 * checked out is gone, so its old handle answers the same 404 a forged one does. A signed-in
 * caller is addressed by their account instead, which `UQ_cart_user` makes singular - a stale
 * cookie from another device cannot then be used to write past their own cart.
 *
 * Every response carries the whole priced cart rather than just the row that changed. The totals
 * move on any write - a discount conditioned on `min_order_value` can switch on when one line is
 * added - so returning a line alone would leave the client showing a total it has to guess at.
 */
class CartPublicController extends BaseController {
	constructor(
		private policy: CartPolicy,
		private validator: CartValidator,
		private cartService: CartService,
	) {
		super();
	}

	private getToken(req: Request): string | null {
		const header = req.headers[CART_TOKEN_HEADER];

		return typeof header === 'string' && header.length > 0 ? header : null;
	}

	/**
	 * The account behind the request, or null for a guest.
	 *
	 * `authMiddleware` seeds every request with a visitor context carrying `id: 0`, so the id is
	 * present whether or not anybody is signed in - a plain `?? null` would keep the zero and try
	 * to attach the cart to a user that does not exist. `isAuthenticated` is what tells the two
	 * apart.
	 */
	private getUserId(res: Response): number | null {
		return this.policy.isAuthenticated(res.locals.auth)
			? (this.policy.getId(res.locals.auth) ?? null)
			: null;
	}

	/**
	 * The cart a write applies to. `resolve` is deliberately not used here: it would create one,
	 * and a request to change a line that names no cart is a mistake worth reporting rather than
	 * an empty cart worth inventing.
	 */
	private async requireCart(
		req: Request,
		res: Response,
	): Promise<CartEntity> {
		return this.cartService.findWritable(
			this.getToken(req) ?? '',
			this.getUserId(res),
		);
	}

	/**
	 * The client a signed-in shopper asked the basket to be priced against, or null.
	 *
	 * A guest is answered with null rather than an error: naming a client requires an account, and
	 * refusing the whole read over an ignorable query parameter would break a basket for the case
	 * this surface exists for. A signed-in caller naming somebody else's client gets the 404
	 * `assertOwnClient` raises.
	 */
	private async previewClientId(
		clientId: number | undefined,
		res: Response,
	): Promise<number | null> {
		const userId = this.getUserId(res);

		if (!clientId || userId === null) {
			return null;
		}

		await this.cartService.assertOwnClient(clientId, userId);

		return clientId;
	}

	private async respond(
		cart: CartEntity,
		res: Response,
		message?: string,
		clientId?: number | null,
	): Promise<void> {
		const data = await this.cartService.withPricing(
			cart,
			res.locals.language,
			clientId,
		);

		res.locals.output.data(data);

		if (message) {
			res.locals.output.message(message);
		}

		res.json(res.locals.output);
	}

	/**
	 * The cart as it stands, created when the caller has none - which is what makes a first page
	 * load hand back a usable token without a separate "start a cart" call.
	 *
	 * Never cached. The lines are the caller's own, and the prices are resolved against the
	 * catalog at this moment, which is the property a cached copy would destroy.
	 */
	public read = asyncHandler(async (req: Request, res: Response) => {
		// `req.query` alone is correct here: the route's path is `''` and declares no params.
		const data = this.validate(this.validator.publicRead, req.query, res);

		const cart = await this.cartService.resolve(
			this.getToken(req),
			this.getUserId(res),
		);

		await this.respond(
			cart,
			res,
			undefined,
			await this.previewClientId(data.client_id, res),
		);
	});

	public addItem = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.addItem, req.body, res);

		// `resolve` rather than `requireCart`: adding the first thing to a basket is how a cart
		// starts, so this is the one write that may legitimately create one.
		const cart = await this.cartService.resolve(
			this.getToken(req),
			this.getUserId(res),
		);

		await this.cartService.addItem(cart, data);

		await this.respond(cart, res, lang('cart.success.add_item'));
	});

	public updateItem = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.updateItem,
			{ ...req.body, id: req.params.id },
			res,
		);

		const cart = await this.requireCart(req, res);

		await this.cartService.updateItem(cart, data);

		await this.respond(cart, res, lang('cart.success.update_item'));
	});

	public removeItem = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.removeItem, req.params, res);

		const cart = await this.requireCart(req, res);

		await this.cartService.removeItem(cart, data.id);

		await this.respond(cart, res, lang('cart.success.remove_item'));
	});

	public clear = asyncHandler(async (req: Request, res: Response) => {
		const cart = await this.requireCart(req, res);

		await this.cartService.clear(cart);

		await this.respond(cart, res, lang('cart.success.clear'));
	});

	/**
	 * Switching market. One column, because no line stores money - the same read path prices the
	 * whole basket against the new currency on the way out.
	 */
	public setCurrency = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.setCurrency, req.body, res);

		const cart = await this.requireCart(req, res);

		const updated = await this.cartService.setCurrency(cart, data.currency);

		await this.respond(updated, res, lang('cart.success.set_currency'));
	});

	/**
	 * Checkout. Requires an account: the order names a `client` to invoice, and it has to be one
	 * of the caller's own (`/public/clients`) - a shopper with none creates one there first. The
	 * delivery choice becomes the order's first `shipping` row and the payment choice is
	 * recorded on the order.
	 *
	 * The cart is terminal afterwards, so the response is the order rather than the basket - there
	 * is no priced cart left to return.
	 */
	public checkout = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.checkout, req.body, res);

		const cart = await this.requireCart(req, res);

		const order = await this.cartService.toOrder(
			cart,
			data,
			this.policy.getId(res.locals.auth) ?? 0,
			res.locals.language,
		);

		res.locals.output.data({
			order_id: order.id,
			ref_code: order.ref_code,
			ref_number: order.ref_number,
			status: order.status,
			issued_at: order.issued_at,
		});
		res.locals.output.message(lang('cart.success.checkout'));

		res.status(201).json(res.locals.output);
	});
}

export const cartPublicController = new CartPublicController(
	cartPolicy,
	new CartValidator('cart'),
	cartService,
);
