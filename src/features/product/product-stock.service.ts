import dataSource from '@/config/data-source.config';
import { ProductCompositionEnum } from '@/features/product/product.entity';
import { getProductRepository } from '@/features/product/product.repository';
import {
	type LoadedComposition,
	type ProductBundleSelectionService,
	productBundleSelectionService,
} from '@/features/product/product-bundle-selection.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import {
	resolveStockAvailability,
	type VariantAvailability,
} from '@/shared/registries/stock-availability.registry';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * What a visitor is told about a variant's stock - a level, never a count. The count is the
 * merchant's: publishing it tells a competitor what sells, and a shopper needs only to know whether
 * to hurry.
 */
export const ProductStockStatusEnum = {
	IN_STOCK: 'in_stock',
	LOW_STOCK: 'low_stock',
	/** None left, and the variant still takes orders - `allow_backorder`. */
	BACKORDER: 'backorder',
	OUT_OF_STOCK: 'out_of_stock',
} as const;

export type ProductStockStatus =
	(typeof ProductStockStatusEnum)[keyof typeof ProductStockStatusEnum];

/** Worst last, so the worse of two levels is the one further along. */
const SEVERITY: readonly ProductStockStatus[] = [
	ProductStockStatusEnum.IN_STOCK,
	ProductStockStatusEnum.LOW_STOCK,
	ProductStockStatusEnum.BACKORDER,
	ProductStockStatusEnum.OUT_OF_STOCK,
];

/**
 * `null` is "not stated": the variant keeps no stock (a dish, a download), or no stock-keeping
 * feature is installed. The page then says nothing rather than "in stock" about a thing that has
 * no stock to be in.
 */
export type ProductVariantStock = {
	variant_id: EntityId;
	stock_status: ProductStockStatus | null;
};

/**
 * The level of one variant - or of a component, per bundle it goes into, with `perUnit` the
 * number of it one bundle takes.
 *
 * "None left" is counted in whole sellable units: below one bundle's worth of a component, or half
 * a laptop, nothing can be sold. "Low" is the merchant's own `low_stock_threshold`, read in the
 * variant's units and inclusive - the comparison the cart makes before showing a line's count. A
 * variant with no threshold is never reported low.
 */
export function toStockStatus(
	stock: VariantAvailability,
	perUnit = 1,
): ProductStockStatus {
	if (Math.floor(stock.available / perUnit) < 1) {
		return stock.allow_backorder
			? ProductStockStatusEnum.BACKORDER
			: ProductStockStatusEnum.OUT_OF_STOCK;
	}

	return stock.low_stock_threshold !== null &&
		stock.available <= stock.low_stock_threshold
		? ProductStockStatusEnum.LOW_STOCK
		: ProductStockStatusEnum.IN_STOCK;
}

function worst(
	statuses: readonly ProductStockStatus[],
): ProductStockStatus | null {
	if (statuses.length === 0) {
		return null;
	}

	return statuses.reduce((current, status) =>
		SEVERITY.indexOf(status) > SEVERITY.indexOf(current) ? status : current,
	);
}

function best(
	statuses: readonly ProductStockStatus[],
): ProductStockStatus | null {
	if (statuses.length === 0) {
		return null;
	}

	return statuses.reduce((current, status) =>
		SEVERITY.indexOf(status) < SEVERITY.indexOf(current) ? status : current,
	);
}

/** `undefined` for an untracked component, which never runs short and so says nothing. */
function componentStatus(
	stock: VariantAvailability | undefined,
	quantity: number,
): ProductStockStatus | undefined {
	if (!stock) {
		return undefined;
	}

	// `numeric` arrives from `pg` as a string; the type says number, so it is converted here
	return toStockStatus(stock, Number(quantity));
}

/**
 * A bundle has no stock of its own (`product.md` §8.4) - what it can be sold of is decided by its
 * components:
 *
 * - every always-included component has to be there, so the worst of them counts
 * - a choice needs only one of its candidates, so each group counts as its best candidate - a
 *   group whose every candidate is gone leaves the bundle unbuyable, one in stock does not
 * - an optional tick box can be left unticked, so it never holds the bundle back
 *
 * The level stated is what the bundle can still be sold as with the best choices made; the cart
 * flags the shopper's own picks when they are added. `null` when no component tracks stock.
 */
export function bundleStatus(
	composition: LoadedComposition,
	availability: Map<EntityId, VariantAvailability>,
): ProductStockStatus | null {
	const counted: ProductStockStatus[] = [];

	for (const item of composition.mandatory) {
		const status = componentStatus(
			availability.get(item.variant_id),
			item.quantity,
		);

		if (status) {
			counted.push(status);
		}
	}

	for (const candidates of composition.candidatesByGroup.values()) {
		const statuses: ProductStockStatus[] = [];
		let hasUntracked = false;

		for (const item of candidates) {
			const status = componentStatus(
				availability.get(item.variant_id),
				item.quantity,
			);

			if (status) {
				statuses.push(status);
			} else {
				hasUntracked = true;
			}
		}

		// One untracked candidate can always be taken, so the choice never holds the bundle back
		const groupStatus = hasUntracked ? null : best(statuses);

		if (groupStatus) {
			counted.push(groupStatus);
		}
	}

	return worst(counted);
}

export class ProductStockService {
	constructor(
		private repository: ReturnType<typeof getProductRepository>,
		private bundleSelection: ProductBundleSelectionService,
	) {}

	/**
	 * @description Used in `stock` method from public controller
	 *
	 * The stock level of every live variant of a sellable product. A product outside its sellable
	 * window answers 404, the same as the public read - this route must not tell a visitor that a
	 * draft exists.
	 *
	 * Never cached, at either end: a level is only worth stating while it is true, and the product
	 * read it sits beside is cached for minutes. Three queries for a simple product (the variants,
	 * then on hand and reserved in the stock feature), two more for a bundle's composition.
	 */
	public async getPublicStock(id: EntityId): Promise<ProductVariantStock[]> {
		const product = await this.repository
			.createQuery()
			.select(['product.id', 'product.composition'])
			.filterById(id)
			.filterBySellable(true)
			.firstOrFail();

		const variants = await dataSource
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true },
				where: { product_id: product.id },
				order: { position: 'ASC', id: 'ASC' },
			});

		if (product.composition === ProductCompositionEnum.BUNDLE) {
			const composition = (
				await this.bundleSelection.loadComposition([product.id])
			).get(product.id);

			const components = composition
				? [
						...composition.mandatory,
						...[...composition.candidatesByGroup.values()].flat(),
					]
				: [];

			const availability = await resolveStockAvailability([
				...new Set(components.map((item) => item.variant_id)),
			]);

			// Every variant of a bundle is the same kit, so they share the one level
			const status = composition
				? bundleStatus(composition, availability)
				: null;

			return variants.map((variant) => ({
				variant_id: variant.id,
				stock_status: status,
			}));
		}

		const availability = await resolveStockAvailability(
			variants.map((variant) => variant.id),
		);

		return variants.map((variant) => {
			const stock = availability.get(variant.id);

			return {
				variant_id: variant.id,
				stock_status: stock ? toStockStatus(stock) : null,
			};
		});
	}
}

export const productStockService = new ProductStockService(
	getProductRepository(),
	productBundleSelectionService,
);
