import type { Request, Response } from 'express';
import {
	type AddressPolicy,
	addressPolicy,
} from '@/features/address/address.policy';
import {
	type AddressService,
	addressService,
} from '@/features/address/address.service';
import { AddressValidator } from '@/features/address/address.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/** How many addresses one search answers with - a dropdown's worth. */
export const ADDRESS_PUBLIC_LIMIT = 10;

/**
 * The storefront address search behind "Add address" at checkout - the twin of the dashboard's
 * address picker in "Add client address".
 *
 * No permission, but an account: the dashboard `find` is gated by `address` / `find`, which a
 * shopper does not hold. The search covers the whole address table by product decision (see
 * `AddressService.findForPicker`), so requiring a session is the one bound on who can read it.
 */
class AddressPublicController extends BaseController {
	constructor(
		private policy: AddressPolicy,
		private validator: AddressValidator,
		private addressService: AddressService,
	) {
		super();
	}

	public find = asyncHandler(async (req: Request, res: Response) => {
		this.policy.requiredAuth(res.locals.auth);

		const data = this.validate(this.validator.publicFind, req.query, res);

		const entries = await this.addressService.findForPicker(
			data.term,
			res.locals.language,
			ADDRESS_PUBLIC_LIMIT,
		);

		res.locals.output.data({
			entries: entries,
		});

		res.json(res.locals.output);
	});
}

export const addressPublicController = new AddressPublicController(
	addressPolicy,
	new AddressValidator('address'),
	addressService,
);
