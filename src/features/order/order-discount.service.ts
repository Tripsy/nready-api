import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import {
	type DiscountResolutionService,
	discountResolutionService,
} from '@/features/discount/discount-resolution.service';
import ProductCategoryEntity from '@/features/product/product-category.entity';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { roundMoney } from '@/helpers/shop.helper';

/** What the resolver needs from one line of the document being composed. */
export type OrderDiscountLine = {
	variant_id: number;
	product_id: number;
	quantity: number;
	/** Unit price excluding VAT, in the document's currency, as the operator stated it. */
	price: number;
};

export type OrderLineDiscount = {
	snapshot: DiscountSnapshot | null;
	/** Money off the whole line, in the document's currency. Zero when nothing applied. */
	reduction: number;
};

export type OrderDiscountContext = {
	clientId: number;
	currency: string;
	/** Rate to the base currency, following `order_line.exchange_rate`. */
	exchangeRate: number;
	/**
	 * The moment the discounts are asked about - the document's issue date, so a backdated order
	 * gets the campaign that was running the day it was issued rather than today's.
	 */
	now: Date;
};

/**
 * Applies the catalog's own discounts to a back-office document.
 *
 * The operator states quantity and unit price; what comes off them is the catalog's decision, the
 * same one the storefront makes - so a campaign, a client agreement or a brand promotion reaches a
 * phone order without anybody remembering it exists. `DiscountResolutionService` picks the single
 * best rule per line and clamps it against `product_price.min_price`, so the floor a market
 * committed to holds here too.
 *
 * **A typed price still stands.** The discount is computed off whatever the operator agreed, not
 * off the list price - quoting under the catalog and then taking a percentage off that is what the
 * clamp exists to bound, and the reduction is stored beside the line rather than folded into it.
 *
 * The catalog is read in three queries whatever the document holds, for the same reason the cart
 * pass batches: a per-line lookup is an N+1 on a save an operator waits on. It duplicates the
 * variant read `OrderService.checkLines` already does, because that one answers a different
 * question and carries neither the brand nor the categories a discount targets.
 */
export class OrderDiscountService {
	constructor(private discountResolution: DiscountResolutionService) {}

	public async resolveForLines(
		lines: readonly OrderDiscountLine[],
		context: OrderDiscountContext,
	): Promise<OrderLineDiscount[]> {
		if (lines.length === 0) {
			return [];
		}

		const catalog = await this.loadCatalog(lines, context.currency);

		// The whole document's value before anything comes off, since `min_order_value` is a
		// condition on it - and it has to exist before the first line can be costed.
		const orderValue = roundMoney(
			lines.reduce(
				(sum, line) => sum + roundMoney(line.price * line.quantity),
				0,
			),
		);

		return Promise.all(
			lines.map(async (line) => {
				const resolved = await this.discountResolution.resolveForLine({
					clientId: context.clientId,
					variantId: line.variant_id,
					productId: line.product_id,
					brandId:
						catalog.brandByProduct.get(line.product_id) ?? null,
					categoryIds:
						catalog.categoriesByProduct.get(line.product_id) ?? [],
					quantity: line.quantity,
					unitPrice: line.price,
					exchangeRate: context.exchangeRate,
					minPrice:
						catalog.minPriceByVariant.get(line.variant_id) ?? null,
					orderValue: orderValue,
					now: context.now,
				});

				return {
					snapshot: resolved?.snapshot ?? null,
					reduction: resolved?.reduction ?? 0,
				};
			}),
		);
	}

	/**
	 * The brand, categories and price floor the lines could be discounted against.
	 *
	 * A variant with no `product_price` row in this currency simply has no floor - the operator
	 * priced the line by hand, and a market that never stated a minimum has not committed to one.
	 */
	private async loadCatalog(
		lines: readonly OrderDiscountLine[],
		currency: string,
	) {
		const variantIds = [...new Set(lines.map((line) => line.variant_id))];
		const productIds = [...new Set(lines.map((line) => line.product_id))];

		const [variants, prices, productCategories] = await Promise.all([
			dataSource.getRepository(ProductVariantEntity).find({
				where: { id: In(variantIds) },
				relations: { product: true },
			}),
			dataSource.getRepository(ProductPriceEntity).find({
				where: { variant_id: In(variantIds), currency: currency },
			}),
			dataSource.getRepository(ProductCategoryEntity).find({
				where: { product_id: In(productIds) },
			}),
		]);

		const categoriesByProduct = new Map<number, number[]>();

		for (const row of productCategories) {
			const list = categoriesByProduct.get(row.product_id) ?? [];

			list.push(row.category_id);
			categoriesByProduct.set(row.product_id, list);
		}

		const brandByProduct = new Map<number, number | null>();

		for (const variant of variants) {
			if (variant.product) {
				brandByProduct.set(
					variant.product.id,
					variant.product.brand_id,
				);
			}
		}

		return {
			minPriceByVariant: new Map(
				prices.map((price) => [price.variant_id, price.min_price]),
			),
			categoriesByProduct: categoriesByProduct,
			brandByProduct: brandByProduct,
		};
	}
}

export const orderDiscountService = new OrderDiscountService(
	discountResolutionService,
);
