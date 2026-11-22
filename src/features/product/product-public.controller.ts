import type { Request, Response } from 'express';
import ProductEntity from '@/features/product/product.entity';
import {
	type ProductService,
	productService,
} from '@/features/product/product.service';
import { ProductValidator } from '@/features/product/product.validator';
import {
	type ProductStockService,
	productStockService,
} from '@/features/product/product-stock.service';
import asyncHandler from '@/helpers/async.handler';
import { type CacheProvider, cacheProvider } from '@/providers/cache.provider';
import { BaseController } from '@/shared/abstracts/controller.abstract';

/**
 * The storefront surface. No policy: a catalog is public by definition, and what a visitor may
 * see is decided by the query instead - every read here goes through `filterBySellable`, so a
 * draft, an unreleased or a withdrawn product is not addressable by any route on this module.
 */
class ProductPublicController extends BaseController {
	constructor(
		private validator: ProductValidator,
		private cache: CacheProvider,
		private productService: ProductService,
		private productStockService: ProductStockService,
	) {
		super();
	}

	public read = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.publicRead,
			{
				...req.query,
				slug: req.params.slug,
			},
			res,
		);

		const language = data.language ?? res.locals.language;

		/*
		 * The slug resolves to an id first, so the cached payload is keyed the way
		 * `cleanEntityCache` invalidates - by `product:<id>*`. A slug-keyed entry would outlive
		 * an edit until its TTL, and the sellable window would be baked into it.
		 */
		const ref = await this.productService.resolvePublicRef(
			data.slug,
			language,
		);

		const cacheGetResults = await this.cache.get(
			this.cache.buildKey(
				ProductEntity.NAME,
				ref.id.toString(),
				language,
				'public-read',
			),
			() => this.productService.getPublicEntryById(ref.id, language),
		);

		res.locals.output.meta(cacheGetResults.isCached, 'isCached');
		res.locals.output.data(cacheGetResults.data);

		res.json(res.locals.output);
	});

	/**
	 * Read apart from `read` so the level is never cached with the product - see
	 * `ProductStockService.getPublicStock`.
	 */
	public stock = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(
			this.validator.publicStock,
			{ id: req.params.id },
			res,
		);

		res.locals.output.data({
			entries: await this.productStockService.getPublicStock(data.id),
		});

		res.json(res.locals.output);
	});

	public find = asyncHandler(async (req: Request, res: Response) => {
		const data = this.validate(this.validator.publicFind, req.query, res);

		if (!data.filter.language) {
			data.filter.language = res.locals.language;
		}

		const [entries, total] =
			await this.productService.findByFilterPublic(data);

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

export const productPublicController = new ProductPublicController(
	new ProductValidator('product'),
	cacheProvider,
	productService,
	productStockService,
);
