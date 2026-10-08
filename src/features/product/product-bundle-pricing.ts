import { apportion, roundMoney } from '@/helpers/shop.helper';

/**
 * The bundle arithmetic of `rules/product.md` §8.1 and §8.3, written once for every path that
 * turns a bundle into order lines - the cart pricing a basket, and the back office composing or
 * editing an order. Pure, so both reach the same cent from the same figures.
 */

/** One component as the arithmetic sees it, per one unit of the bundle. */
export type BundlePricingComponent = {
	/** The component's own sale price per unit, excluding VAT, in the sale currency. */
	standalone: number;
	/** How many of it one bundle contains. */
	units: number;
	/** Part of the kit (§8.1 case 1) - the bundle's headline price already covers it. */
	included: boolean;
	/** `product_bundle_item_price.price_delta` in the sale currency; ignored when `included`. */
	delta: number;
};

/**
 * What one bundle costs as composed: the headline price plus, for every component taken beyond
 * the kit, its standalone price adjusted by its delta, times the units taken.
 */
export function quoteBundleUnit(
	basePrice: number,
	components: readonly BundlePricingComponent[],
): number {
	return roundMoney(
		components.reduce(
			(sum, component) =>
				component.included
					? sum
					: sum +
						roundMoney(
							(component.standalone + component.delta) *
								component.units,
						),
			basePrice,
		),
	);
}

/**
 * Divides one bundle's price over its components, pro-rata by their standalone value, and states
 * each share **per unit** of the component - the figure an order line carries as `price`.
 * Index-aligned with `components`.
 *
 * The split goes through `apportion()`, which hands the rounding remainder to the largest share so
 * the parts reconcile to the whole (§8.3). The per-unit figure is then rounded on its own, so a
 * component taken twice can drift a cent from its share - the same figure the cart has always
 * quoted, kept identical on purpose.
 */
export function splitBundleUnit(
	bundleUnit: number,
	components: readonly Pick<BundlePricingComponent, 'standalone' | 'units'>[],
): number[] {
	const shares = apportion(
		bundleUnit,
		components.map((component) => component.standalone * component.units),
	);

	return components.map((component, index) =>
		roundMoney(shares[index] / component.units),
	);
}
