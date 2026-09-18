import type { Request, Response } from 'express';
import {
	type PlaceService,
	placeService,
} from '@/features/place/place.service';
import { PlaceValidator } from '@/features/place/place.validator';
import asyncHandler from '@/helpers/async.handler';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/** How many cities one search answers with - enough to type past, small enough for a dropdown. */
export const PLACE_PUBLIC_LIMIT = 10;

/**
 * The storefront's city search, for the addresses a shopper files at checkout.
 *
 * The dashboard `find` is gated by the `place` / `find` permission, which a shopper does not hold.
 * Place names are catalog reference data rather than anybody's record, so this read needs no
 * account - and it is narrowed to what an address picker needs: cities only, by name, one page.
 */
class PlacePublicController extends BaseController {
	constructor(
		private validator: PlaceValidator,
		private placeService: PlaceService,
	) {
		super();
	}

	public find = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.publicFind, req.query, res);

		const entries = await this.placeService.findCities(
			data.term,
			res.locals.language,
			PLACE_PUBLIC_LIMIT,
		);

		res.locals.output.data({
			entries: entries,
		});

		res.json(res.locals.output);
	});
}

export const placePublicController = new PlacePublicController(
	new PlaceValidator('place'),
	placeService,
);
