import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import type CartEntity from '@/features/cart/cart.entity';
import type CartItemEntity from '@/features/cart/cart-item.entity';
import type { DiscountSnapshot } from '@/features/discount/discount.entity';
import {
	type DiscountResolutionService,
	discountResolutionService,
} from '@/features/discount/discount-resolution.service';
import type ProductEntity from '@/features/product/product.entity';
import {
	ProductCompositionEnum,
	ProductSaleStatusEnum,
} from '@/features/product/product.entity';
import ProductBundleItemPriceEntity from '@/features/product/product-bundle-item-price.entity';
import {
	type BundleChoice,
	ProductBundleSelectionService,
	productBundleSelectionService,
} from '@/features/product/product-bundle-selection.service';
import ProductCategoryEntity from '@/features/product/product-category.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import type { ProductOptionSnapshot } from '@/features/product/product-option.entity';
import ProductOptionEntity from '@/features/product/product-option.entity';
import ProductOptionPriceEntity from '@/features/product/product-option-price.entity';
import {
	ProductOptionSelectionService,
	productOptionSelectionService,
} from '@/features/product/product-option-selection.service';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import TermContentEntity from '@/features/term/term-content.entity';
import { apportion, resolveVatRate, roundMoney } from '@/helpers/shop.helper';

/**
 * Why a line cannot be bought as it stands. The line is still returned when one of these is set -
 * a shopper has to see what dropped out and why, rather than find their cart quietly shorter - but
 * it contributes nothing to the totals and blocks checkout.
 */
export const CartLineIssueEnum = {
	VARIANT_GONE: 'variant_gone', // Variant or product deleted from the catalog
	NOT_SELLABLE: 'not_sellable', // Outside its availability window, or discontinued
	NO_PRICE: 'no_price', // No `product_price` row in the cart's currency
	OPTION_GONE: 'option_gone', // A chosen option no longer exists on the product
	OPTION_SELECTION: 'option_selection', // The options no longer answer the product's questions within their bounds
	BUNDLE_CHANGED: 'bundle_changed', // The bundle's composition moved under the line
} as const;

export type CartLineIssue =
	(typeof CartLineIssueEnum)[keyof typeof CartLineIssueEnum];

/**
 * One priced line. Every money field here is **derived** and lives only in the response - nothing
 * below is stored on `cart_item`, which is the whole reason a cart may sit untouched for weeks and
 * still quote today's catalog.
 *
 * A bundle is a header line plus one line per component, the shape the order takes at checkout
 * (`product.md` §8.3). The header carries **no money**: `unit_price` and `subtotal` are zero on it
 * and the components hold the bundle's whole price between them, each at its own VAT rate. Summing
 * every line is therefore correct with no special-casing, which is also how `OrderService`
 * computes a document's totals.
 */
export type CartLine = {
	id: number;
	/** The bundle line this one is a component of; null on every line a shopper added directly. */
	parent_id: number | null;
	/** Which `product_bundle_item` this line materializes; null unless it is a component. */
	bundle_item_id: number | null;
	/** True on a bundle header, so a client knows to render its components beneath it. */
	is_bundle: boolean;
	variant_id: number;
	product_id: number;
	sku: string | null;
	/**
	 * The product's name in the served content language, so a basket can say what a line is -
	 * a component names another product than its bundle, and its SKU tells a shopper nothing.
	 * `null` when the variant is gone or the product has no translation in that language.
	 */
	label: string | null;
	/** The product's slug in the same language, so a basket can link the line to its page. */
	slug: string | null;
	quantity: number;
	notes: string | null;

	/** Unit price excluding VAT, in the cart's currency, options already folded in. */
	unit_price: number;
	/** The catalog price before the options moved it, for a UI that wants to show the delta. */
	base_price: number;
	options: ProductOptionSnapshot[];

	vat_rate: number;
	/** `unit_price × quantity`, excluding VAT and before any discount. */
	subtotal: number;
	/** Money off the whole line, in the cart's currency. */
	discount_reduction: number;
	discount: DiscountSnapshot | null;
	/** `subtotal - discount_reduction`, excluding VAT. What the line actually costs. */
	total: number;
	vat_amount: number;

	issue: CartLineIssue | null;
};

/**
 * A quote, not a document. It carries no exchange rate: the basket is priced in the shopper's own
 * currency and nothing here is frozen, so there is no money to convert yet. The rate is resolved
 * once, by `OrderService`, at the moment the order is raised.
 */
export type CartPricing = {
	currency: string;
	lines: CartLine[];
	/** Sum of `subtotal` over sellable lines, excluding VAT. */
	subtotal: number;
	discount_reduction: number;
	vat_amount: number;
	/** What the shopper would pay, VAT included. */
	total: number;
	/** True while any line carries an `issue` - checkout is refused until they are resolved. */
	has_issues: boolean;
};

/**
 * Whether the catalog will sell this product right now.
 *
 * `sale_status` is recomputed by a cron rather than on read, so it lags its own window by up to
 * one run. The dates are therefore checked here as well: a cart is priced at the moment somebody
 * looks at it, and quoting a product whose window closed an hour ago is a promise the checkout
 * would then have to break.
 */
function isSellable(product: ProductEntity, now: Date): boolean {
	if (product.sale_status === ProductSaleStatusEnum.DISCONTINUED) {
		return false;
	}

	if (product.discontinued_at !== null) {
		return false;
	}

	if (product.available_from !== null && product.available_from > now) {
		return false;
	}

	if (product.available_until !== null && product.available_until < now) {
		return false;
	}

	return true;
}

/**
 * Turns the stored references on a cart into money, against the catalog as it is at `now`.
 *
 * Everything is loaded in a fixed number of queries whatever the cart holds - variants, prices,
 * categories, options and bundle composition each come back in one round trip and are indexed in
 * memory. A per-line lookup would be an N+1 on a path the storefront hits on every page that shows
 * a basket badge.
 */
export class CartPricingService {
	constructor(
		private discountResolution: DiscountResolutionService,
		private optionSelection: ProductOptionSelectionService,
		private bundleSelection: ProductBundleSelectionService,
	) {}

	public async price(
		cart: CartEntity,
		items: CartItemEntity[],
		language: string = Configuration.language(),
		now: Date = new Date(),
	): Promise<CartPricing> {
		if (items.length === 0) {
			return {
				currency: cart.currency,
				lines: [],
				subtotal: 0,
				discount_reduction: 0,
				vat_amount: 0,
				total: 0,
				has_issues: false,
			};
		}

		const catalog = await this.loadCatalog(cart.currency, language, items);

		const childrenByParent = new Map<number, CartItemEntity[]>();

		for (const item of items) {
			if (item.parent_id === null) {
				continue;
			}

			const list = childrenByParent.get(item.parent_id) ?? [];

			list.push(item);
			childrenByParent.set(item.parent_id, list);
		}

		// First pass: what each line costs before any discount. The basket subtotal has to exist
		// before the discounts are resolved, since `min_order_value` is a condition on it.
		const draftLines = items
			.filter((item) => item.parent_id === null)
			.flatMap((item) =>
				this.buildGroup(
					item,
					childrenByParent.get(item.id) ?? [],
					cart.currency,
					catalog,
					now,
				),
			);

		const subtotal = roundMoney(
			draftLines.reduce(
				(sum, line) =>
					line.issue === null ? sum + line.subtotal : sum,
				0,
			),
		);

		// Second pass: the best discount per line, costed against that subtotal.
		const lines = await Promise.all(
			draftLines.map(async (line) => {
				/*
				 * A bundle header is skipped because it carries no money to reduce. Its components
				 * are ordinary variants and are costed like any other line, so a campaign on one
				 * of them reaches a bundle - but a discount naming the **bundle product** itself
				 * never fires, having nothing but a zero to apply to.
				 */
				if (line.issue !== null || line.is_bundle) {
					return line;
				}

				const resolved = await this.discountResolution.resolveForLine({
					variantId: line.variant_id,
					productId: line.product_id,
					brandId:
						catalog.brandByProduct.get(line.product_id) ?? null,
					categoryIds:
						catalog.categoriesByProduct.get(line.product_id) ?? [],
					quantity: line.quantity,
					unitPrice: line.unit_price,
					minPrice:
						catalog.minPriceByVariant.get(line.variant_id) ?? null,
					orderValue: subtotal,
					now: now,
				});

				const reduction = resolved?.reduction ?? 0;
				const total = roundMoney(line.subtotal - reduction);

				return {
					...line,
					discount_reduction: reduction,
					discount: resolved?.snapshot ?? null,
					total: total,
					vat_amount: roundMoney((total * line.vat_rate) / 100),
				};
			}),
		);

		const sellable = lines.filter((line) => line.issue === null);

		const discountReduction = roundMoney(
			sellable.reduce((sum, line) => sum + line.discount_reduction, 0),
		);
		const vatAmount = roundMoney(
			sellable.reduce((sum, line) => sum + line.vat_amount, 0),
		);
		const netTotal = roundMoney(subtotal - discountReduction);

		return {
			currency: cart.currency,
			lines: lines,
			subtotal: subtotal,
			discount_reduction: discountReduction,
			vat_amount: vatAmount,
			total: roundMoney(netTotal + vatAmount),
			has_issues: lines.some((line) => line.issue !== null),
		};
	}

	/**
	 * Everything the lines need from the catalog, in a fixed number of queries regardless of cart
	 * size.
	 *
	 * Component rows are ordinary `cart_item` rows, so their variants and prices ride along in the
	 * same batch as the headers' - the only reads a bundle adds are its composition and the
	 * per-currency deltas of the components cited.
	 *
	 * Variants are read `withDeleted` on purpose. A soft-deleted variant is the everyday case the
	 * CASCADE foreign key never fires for, and finding nothing would make the line vanish from the
	 * response with no explanation; loading it lets the pass report `variant_gone` against a line
	 * the shopper can still see and remove.
	 */
	private async loadCatalog(
		currency: string,
		language: string,
		items: CartItemEntity[],
	) {
		const variantIds = [...new Set(items.map((item) => item.variant_id))];
		const productIds = [...new Set(items.map((item) => item.product_id))];
		const optionIds = [
			...new Set(items.flatMap((item) => item.options ?? [])),
		];
		const bundleItemIds = [
			...new Set(
				items
					.map((item) => item.bundle_item_id)
					.filter((id): id is number => id !== null),
			),
		];
		// Only the lines a shopper added directly can be a bundle; a component never is, since
		// `product.md` §8.4 forbids nesting one inside another.
		const headerProductIds = [
			...new Set(
				items
					.filter((item) => item.parent_id === null)
					.map((item) => item.product_id),
			),
		];

		const [
			variants,
			prices,
			productCategories,
			options,
			optionPrices,
			optionLabels,
			optionGroups,
			bundleDeltas,
			compositions,
			productContents,
		] = await Promise.all([
			dataSource.getRepository(ProductVariantEntity).find({
				where: { id: In(variantIds) },
				relations: { product: true },
				withDeleted: true,
			}),
			dataSource.getRepository(ProductPriceEntity).find({
				where: { variant_id: In(variantIds), currency: currency },
			}),
			dataSource.getRepository(ProductCategoryEntity).find({
				where: { product_id: In(productIds) },
			}),
			optionIds.length === 0
				? []
				: dataSource.getRepository(ProductOptionEntity).find({
						where: { id: In(optionIds) },
						relations: { option_group: true },
					}),
			optionIds.length === 0
				? []
				: dataSource.getRepository(ProductOptionPriceEntity).find({
						where: {
							option_id: In(optionIds),
							currency: currency,
						},
					}),
			/*
			 * Option labels are `term` rows, so the name the shopper sees is resolved in
			 * their own content language - the same source the menu renders from. The
			 * lookup is by `label_id`, which is known only after the options come back,
			 * so this reads the terms of every option cited by the cart and discards the
			 * ones the lines turn out not to need.
			 */
			optionIds.length === 0
				? []
				: dataSource
						.getRepository(TermContentEntity)
						.createQueryBuilder('content')
						.innerJoin(
							ProductOptionEntity,
							'option',
							'option.label_id = content.term_id',
						)
						.where('option.id IN (:...optionIds)', {
							optionIds,
						})
						.andWhere('content.language = :language', {
							language,
						})
						.select([
							'content.term_id AS term_id',
							'content.value AS value',
						])
						.getRawMany<{ term_id: number; value: string }>(),
			/*
			 * Every question each product asks, so a line whose answers stopped fitting - a
			 * required group added after the item went in, an answer moved to another group -
			 * is reported here rather than surfacing when an operator edits the order.
			 */
			this.optionSelection.loadGroups(productIds),
			bundleItemIds.length === 0
				? []
				: dataSource.getRepository(ProductBundleItemPriceEntity).find({
						where: {
							item_id: In(bundleItemIds),
							currency: currency,
						},
					}),
			this.bundleSelection.loadComposition(headerProductIds),
			// Names only, in the shopper's content language - one row per product at most, by
			// the `(product_id, language)` unique index.
			dataSource.getRepository(ProductContentEntity).find({
				select: { product_id: true, label: true, slug: true },
				where: { product_id: In(productIds), language: language },
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
			variantById: new Map(
				variants.map((variant) => [variant.id, variant]),
			),
			priceByVariant: new Map(
				prices.map((price) => [price.variant_id, price.sale_price]),
			),
			minPriceByVariant: new Map(
				prices.map((price) => [price.variant_id, price.min_price]),
			),
			optionById: new Map(options.map((option) => [option.id, option])),
			optionDeltaById: new Map(
				optionPrices.map((price) => [
					price.option_id,
					price.price_delta,
				]),
			),
			labelByTerm: new Map(
				optionLabels.map((row) => [row.term_id, row.value]),
			),
			categoriesByProduct: categoriesByProduct,
			brandByProduct: brandByProduct,
			optionGroupsByProduct: optionGroups,
			bundleDeltaByItem: new Map(
				bundleDeltas.map((row) => [row.item_id, row.price_delta]),
			),
			compositionByProduct: compositions,
			contentByProduct: new Map(
				productContents.map((content) => [
					content.product_id,
					{ label: content.label, slug: content.slug },
				]),
			),
		};
	}

	/**
	 * One line a shopper added, plus its components when it is a bundle.
	 *
	 * A line with no components prices exactly as it always has. A bundle takes the second path,
	 * where the header ends up carrying nothing and the components carry it all.
	 */
	private buildGroup(
		item: CartItemEntity,
		children: CartItemEntity[],
		currency: string,
		catalog: Awaited<ReturnType<CartPricingService['loadCatalog']>>,
		now: Date,
	): CartLine[] {
		const header = this.buildLine(item, currency, catalog, now);

		const product = catalog.variantById.get(item.variant_id)?.product;

		if (product?.composition !== ProductCompositionEnum.BUNDLE) {
			return [header];
		}

		/*
		 * A bundle carrying no component rows is a line written before the product became one, or
		 * one whose components have all been withdrawn. Pricing it as a plain variant would charge
		 * the bundle's headline figure at its own `vat_category` - the column §8.4 calls unused,
		 * the components carrying their own - so the line is reported rather than quoted.
		 *
		 * The check belongs here rather than in `buildLine`, which cannot see whether the line has
		 * components: raising it there flags every bundle, including the well-formed ones, and
		 * `buildBundle` then refuses the header before it prices anything.
		 */
		if (children.length === 0) {
			return [
				{
					...header,
					is_bundle: true,
					unit_price: 0,
					base_price: 0,
					vat_rate: 0,
					subtotal: 0,
					total: 0,
					vat_amount: 0,
					issue: CartLineIssueEnum.BUNDLE_CHANGED,
				},
			];
		}

		return this.buildBundle(header, item, children, currency, catalog, now);
	}

	/**
	 * A bundle, split the way `product.md` §8.3 requires.
	 *
	 * What the customer pays for one bundle is the headline price of its own variant plus, for
	 * every component they chose to take, that component's standalone price adjusted by its
	 * `product_bundle_item_price` delta. Components that come with the kit add nothing - the
	 * bundle price already covers them, which is why the delta on an optional one is usually
	 * negative rather than being the price itself.
	 *
	 * That figure is then apportioned across **all** the components, pro-rata by their standalone
	 * prices, so each carries a share at its own VAT rate - food at 11% beside a drink at 21%,
	 * which one rate on one line cannot state. The header keeps nothing.
	 *
	 * The composition is re-read on every pass rather than trusted from the stored rows: a
	 * merchant may have changed the bundle since the line was written, and quoting a kit the
	 * catalog no longer sells is the one outcome worse than reporting the line as broken.
	 *
	 * ⚠️ Apportionment reconciles per bundle, and a component taken in several units divides its
	 * share again to reach a unit price. Where that does not divide evenly the line totals can sit
	 * a cent either side of the bundle price times its quantity.
	 */
	private buildBundle(
		header: CartLine,
		item: CartItemEntity,
		children: CartItemEntity[],
		currency: string,
		catalog: Awaited<ReturnType<CartPricingService['loadCatalog']>>,
		now: Date,
	): CartLine[] {
		const broken = (issue: CartLineIssue): CartLine[] => [
			{
				...header,
				is_bundle: true,
				unit_price: 0,
				base_price: 0,
				subtotal: 0,
				total: 0,
				vat_amount: 0,
				vat_rate: 0,
				issue: issue,
			},
		];

		if (header.issue !== null) {
			return broken(header.issue);
		}

		const composition = catalog.compositionByProduct.get(item.product_id);

		if (!composition) {
			return broken(CartLineIssueEnum.BUNDLE_CHANGED);
		}

		/*
		 * The picks are reconstructed from the stored rows and put back through the same check the
		 * add went through. A group emptied, a tick box withdrawn, a ceiling lowered below what
		 * was taken - each reads here as a selection the bundle no longer accepts.
		 */
		const picks: BundleChoice[] = [];

		for (const child of children) {
			if (child.bundle_item_id === null) {
				return broken(CartLineIssueEnum.BUNDLE_CHANGED);
			}

			const component = composition.byId.get(child.bundle_item_id);

			if (!component) {
				return broken(CartLineIssueEnum.BUNDLE_CHANGED);
			}

			if (component.group_id !== null || component.is_optional) {
				picks.push({
					item_id: child.bundle_item_id,
					units: Number(child.quantity),
				});
			}
		}

		if (ProductBundleSelectionService.findProblem(composition, picks)) {
			return broken(CartLineIssueEnum.BUNDLE_CHANGED);
		}

		/*
		 * The kit as the catalog now describes it has to match the rows the line holds. This is
		 * what catches a component **added** to the bundle after the line was written, which the
		 * picks alone cannot see - the line would otherwise quote a menu missing an item.
		 */
		const expected = ProductBundleSelectionService.resolve(
			composition,
			picks,
		);

		const stored = new Set(children.map((child) => child.bundle_item_id));

		if (
			expected.length !== children.length ||
			expected.some((component) => !stored.has(component.item.id))
		) {
			return broken(CartLineIssueEnum.BUNDLE_CHANGED);
		}

		const basePrice = catalog.priceByVariant.get(item.variant_id);

		if (basePrice === undefined) {
			return broken(CartLineIssueEnum.NO_PRICE);
		}

		// Each component priced on its own terms before anything is divided up.
		const parts: {
			child: CartItemEntity;
			line: CartLine;
			standalone: number;
			contribution: number;
		}[] = [];

		for (const child of children) {
			const line = this.buildLine(child, currency, catalog, now);

			if (line.issue !== null) {
				return broken(line.issue);
			}

			const component = composition.byId.get(
				child.bundle_item_id as number,
			);

			if (!component) {
				return broken(CartLineIssueEnum.BUNDLE_CHANGED);
			}

			const standalone = Number(
				catalog.priceByVariant.get(child.variant_id) ?? 0,
			);
			const units = Number(child.quantity);

			const included =
				component.group_id === null && !component.is_optional;

			const delta = included
				? 0
				: Number(catalog.bundleDeltaByItem.get(component.id) ?? 0);

			parts.push({
				child: child,
				line: line,
				standalone: standalone * units,
				contribution: included
					? 0
					: roundMoney((standalone + delta) * units),
			});
		}

		const bundleUnit = roundMoney(
			parts.reduce(
				(sum, part) => sum + part.contribution,
				Number(basePrice),
			),
		);

		const shares = apportion(
			bundleUnit,
			parts.map((part) => part.standalone),
		);

		const componentLines = parts.map((part, index) => {
			const units = Number(part.child.quantity);
			// Absolute, unlike the stored figure: this is what leaves the shelf and what an order
			// line has to state, so the header's own quantity is multiplied in here.
			const quantity = roundMoney(units * Number(item.quantity));
			const unitPrice = roundMoney(shares[index] / units);
			const subtotal = roundMoney(unitPrice * quantity);

			return {
				...part.line,
				parent_id: item.id,
				bundle_item_id: part.child.bundle_item_id,
				is_bundle: false,
				quantity: quantity,
				unit_price: unitPrice,
				base_price: roundMoney(part.standalone / units),
				subtotal: subtotal,
				total: subtotal,
				vat_amount: roundMoney((subtotal * part.line.vat_rate) / 100),
			};
		});

		return [
			{
				...header,
				is_bundle: true,
				// The bundle's own price is stated here for a client to render, while the money
				// itself sits on the components - `base_price` is display, `unit_price` is what
				// the totals add up.
				base_price: bundleUnit,
				unit_price: 0,
				vat_rate: 0,
				subtotal: 0,
				total: 0,
				vat_amount: 0,
			},
			...componentLines,
		];
	}

	/** One line priced from the catalog, before discounts. */
	private buildLine(
		item: CartItemEntity,
		currency: string,
		catalog: Awaited<ReturnType<CartPricingService['loadCatalog']>>,
		now: Date,
	): CartLine {
		const empty: CartLine = {
			id: item.id,
			parent_id: item.parent_id,
			bundle_item_id: item.bundle_item_id,
			is_bundle: false,
			variant_id: item.variant_id,
			product_id: item.product_id,
			sku: null,
			label: null,
			slug: null,
			quantity: item.quantity,
			notes: item.notes,
			unit_price: 0,
			base_price: 0,
			options: [],
			vat_rate: 0,
			subtotal: 0,
			discount_reduction: 0,
			discount: null,
			total: 0,
			vat_amount: 0,
			issue: CartLineIssueEnum.VARIANT_GONE,
		};

		const variant = catalog.variantById.get(item.variant_id);

		if (!variant || variant.deleted_at !== null || !variant.product) {
			return empty;
		}

		const product = variant.product;
		const line = {
			...empty,
			sku: variant.sku,
			label: catalog.contentByProduct.get(product.id)?.label ?? null,
			slug: catalog.contentByProduct.get(product.id)?.slug ?? null,
			issue: null as CartLineIssue | null,
		};

		if (product.deleted_at !== null || !isSellable(product, now)) {
			return { ...line, issue: CartLineIssueEnum.NOT_SELLABLE };
		}

		const basePrice = catalog.priceByVariant.get(item.variant_id);

		if (basePrice === undefined) {
			return { ...line, issue: CartLineIssueEnum.NO_PRICE };
		}

		const chosen = item.options ?? [];
		const snapshots: ProductOptionSnapshot[] = [];

		let optionsDelta = 0;

		for (const optionId of chosen) {
			const option = catalog.optionById.get(optionId);

			// An option is hard-deleted, so absence from the catalog map is the whole test -
			// unlike the variant and product above, which are soft-deletable and need the column
			if (!option) {
				return { ...line, issue: CartLineIssueEnum.OPTION_GONE };
			}

			/*
			 * A missing price row is a zero delta, not a failed line: the option exists and the
			 * product is answerable, the market simply carries no surcharge for it. Contrast a
			 * missing `product_price`, which leaves nothing to charge at all.
			 */
			const delta = catalog.optionDeltaById.get(optionId) ?? 0;

			optionsDelta += Number(delta);

			snapshots.push({
				option_id: optionId,
				label:
					catalog.labelByTerm.get(option.label_id) ??
					String(option.label_id),
				price_delta: Number(delta),
				currency: currency,
			});
		}

		/*
		 * Only on a line the shopper added. A component's own option groups are not theirs to
		 * answer: a bundle offers no way to send options for what is inside it, and `product.md`
		 * §8.4 puts any choice the customer does make on the **bundle product** as a
		 * `product_option_group` rather than on a component. Checking a component against its
		 * product's questions therefore fails a bundle for something nobody could have supplied -
		 * and since `buildBundle` refuses a bundle whose component line carries an issue, one
		 * component with a required group would make the whole bundle unbuyable.
		 */
		if (
			item.parent_id === null &&
			ProductOptionSelectionService.findProblem(
				catalog.optionGroupsByProduct.get(product.id) ?? [],
				chosen,
			)
		) {
			return { ...line, issue: CartLineIssueEnum.OPTION_SELECTION };
		}

		const unitPrice = roundMoney(Number(basePrice) + optionsDelta);
		const vatRate = resolveVatRate(product.vat_category);
		const subtotal = roundMoney(unitPrice * item.quantity);

		return {
			...line,
			unit_price: unitPrice,
			base_price: Number(basePrice),
			options: snapshots,
			vat_rate: vatRate,
			subtotal: subtotal,
			total: subtotal,
			vat_amount: roundMoney((subtotal * vatRate) / 100),
		};
	}
}

export const cartPricingService = new CartPricingService(
	discountResolutionService,
	productOptionSelectionService,
	productBundleSelectionService,
);
