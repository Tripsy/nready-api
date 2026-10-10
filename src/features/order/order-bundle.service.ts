import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError } from '@/exceptions';
import ProductEntity, {
	ProductCompositionEnum,
} from '@/features/product/product.entity';
import { splitBundleUnit } from '@/features/product/product-bundle-pricing';
import {
	type BundleChoice,
	type BundleSelectionProblem,
	ProductBundleSelectionService,
	productBundleSelectionService,
} from '@/features/product/product-bundle-selection.service';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { resolveVatRate, roundMoney } from '@/helpers/shop.helper';

/** What the explosion needs from one line of the document being composed. */
type BundleLine = {
	variant_id: number;
	product_id: number;
	quantity: number;
	/** On a bundle, the price of **one** bundle excluding VAT - what the operator agreed. */
	price: number;
	/** The shopper's decisions only - never a component that comes with the kit. */
	components?: readonly BundleChoice[] | null;
};

/** One component line a bundle explodes into, ready to be written under its header. */
export type BundleComponentLine = {
	variant_id: number;
	product_id: number;
	/** Absolute - the component's units per bundle times the bundle line's own quantity. */
	quantity: number;
	/** This component's share of the bundle price, per unit, excluding VAT. */
	price: number;
	vat_rate: number;
	bundle_item_id: number;
};

/**
 * Turns a back-office bundle line into the header-and-components shape of `rules/product.md` §8.3.
 *
 * The operator states the price of one bundle as composed, the way a checkout's cart arrives with
 * one; what this decides is everything else - which components the choices resolve to
 * (`ProductBundleSelectionService`, the same check the cart's add goes through, so a group answered
 * twice or a tick box over its ceiling is refused here too), and how that price divides over them
 * (`splitBundleUnit`, the cart's own arithmetic), each component at its own VAT rate.
 *
 * **Weights are the components' standalone prices in the document's currency**, as at checkout. A
 * component with no price row in that currency weighs nothing; if none has one, `apportion()`
 * splits evenly rather than leaving the bundle price undivided.
 *
 * Every lookup is batched over the whole document, for the reason `OrderOptionService` gives.
 */
export class OrderBundleService {
	constructor(private bundleSelection: ProductBundleSelectionService) {}

	/**
	 * Index-aligned with `lines`: the component lines for a bundle, null for anything else.
	 *
	 * A line naming components on a product that is not a bundle is refused rather than ignored -
	 * it says the caller believes it composed something it did not.
	 */
	public async explodeForLines(
		lines: readonly BundleLine[],
		currency: string,
	): Promise<(BundleComponentLine[] | null)[]> {
		const productIds = [...new Set(lines.map((line) => line.product_id))];

		const products =
			productIds.length === 0
				? []
				: await dataSource.getRepository(ProductEntity).find({
						select: { id: true, composition: true },
						where: { id: In(productIds) },
					});

		const bundleIds = new Set(
			products
				.filter(
					(product) =>
						product.composition === ProductCompositionEnum.BUNDLE,
				)
				.map((product) => product.id),
		);

		const compositions = await this.bundleSelection.loadComposition([
			...bundleIds,
		]);

		const resolvedPerLine = lines.map((line) => {
			const chosen = line.components ?? [];

			if (!bundleIds.has(line.product_id)) {
				if (chosen.length > 0) {
					throw new BadRequestError(
						lang('order.error.not_a_bundle', {
							variant_id: String(line.variant_id),
						}),
					);
				}

				return null;
			}

			const composition = compositions.get(line.product_id);

			if (!composition) {
				throw new BadRequestError(
					lang('order.error.bundle_empty', {
						variant_id: String(line.variant_id),
					}),
				);
			}

			const problem = ProductBundleSelectionService.findProblem(
				composition,
				chosen,
			);

			if (problem) {
				throw new BadRequestError(
					bundleProblemMessage(problem, line.variant_id),
				);
			}

			return ProductBundleSelectionService.resolve(composition, chosen);
		});

		const componentVariantIds = [
			...new Set(
				resolvedPerLine.flatMap((resolved) =>
					(resolved ?? []).map(
						(component) => component.item.variant_id,
					),
				),
			),
		];

		if (componentVariantIds.length === 0) {
			return resolvedPerLine.map(() => null);
		}

		const [variants, prices] = await Promise.all([
			dataSource.getRepository(ProductVariantEntity).find({
				select: {
					id: true,
					product_id: true,
					product: { id: true, vat_category: true },
				},
				relations: { product: true },
				where: { id: In(componentVariantIds) },
			}),
			dataSource.getRepository(ProductPriceEntity).find({
				select: { variant_id: true, sale_price: true },
				where: {
					variant_id: In(componentVariantIds),
					currency: currency,
				},
			}),
		]);

		const variantById = new Map(
			variants.map((variant) => [variant.id, variant]),
		);
		const priceByVariant = new Map(
			prices.map((price) => [price.variant_id, Number(price.sale_price)]),
		);

		return resolvedPerLine.map((resolved, index) => {
			if (!resolved) {
				return null;
			}

			const line = lines[index];

			const components = resolved.map((component) => {
				const variant = variantById.get(component.item.variant_id);

				if (!variant?.product) {
					// `product_bundle_item.variant_id` is RESTRICT, so this is a catalog that
					// changed under the read rather than a state the schema allows
					throw new BadRequestError(
						lang('order.error.bundle_changed', {
							variant_id: String(line.variant_id),
						}),
					);
				}

				return {
					component: component,
					variant: variant,
					standalone:
						priceByVariant.get(component.item.variant_id) ?? 0,
				};
			});

			const unitPrices = splitBundleUnit(
				line.price,
				components.map((entry) => ({
					standalone: entry.standalone,
					units: entry.component.units,
				})),
			);

			return components.map((entry, position) => ({
				variant_id: entry.variant.id,
				product_id: entry.variant.product_id,
				quantity: roundMoney(entry.component.units * line.quantity),
				price: unitPrices[position],
				vat_rate: resolveVatRate(entry.variant.product.vat_category),
				bundle_item_id: entry.component.item.id,
			}));
		});
	}
}

/** The cart's wording for a selection the bundle refuses, naming the line it is on. */
function bundleProblemMessage(
	problem: BundleSelectionProblem,
	variantId: number,
): string {
	const variant = String(variantId);

	switch (problem.reason) {
		case 'foreign_component':
			return lang('order.error.bundle_component_invalid', {
				variant_id: variant,
			});
		case 'included_component':
			return lang('order.error.bundle_component_included', {
				variant_id: variant,
			});
		case 'group_unanswered':
			return lang('order.error.bundle_group_unanswered', {
				variant_id: variant,
			});
		case 'group_multiple':
			return lang('order.error.bundle_group_multiple', {
				variant_id: variant,
			});
		case 'over_ceiling':
			return lang('order.error.bundle_component_ceiling', {
				variant_id: variant,
				max: String(problem.max),
			});
	}
}

export const orderBundleService = new OrderBundleService(
	productBundleSelectionService,
);
