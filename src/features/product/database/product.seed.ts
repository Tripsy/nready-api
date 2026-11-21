import {
	isDirectRun,
	loadIds,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import BrandEntity from '@/features/brand/brand.entity';
import CategoryContentEntity from '@/features/category/category-content.entity';
import ProductEntity, {
	ProductCompositionEnum,
	ProductSaleStatusEnum,
	ProductTypeEnum,
	ProductUnitEnum,
	type ProductVatCategory,
	ProductVatCategoryEnum,
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import ProductAttributeEntity from '@/features/product/product-attribute.entity';
import ProductAvailabilityEntity from '@/features/product/product-availability.entity';
import ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import ProductBundleItemPriceEntity from '@/features/product/product-bundle-item-price.entity';
import ProductCategoryEntity from '@/features/product/product-category.entity';
import ProductCategoryAttributeEntity, {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import ProductCategoryAttributeOptionEntity from '@/features/product/product-category-attribute-option.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import ProductOptionEntity from '@/features/product/product-option.entity';
import ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import ProductOptionPriceEntity from '@/features/product/product-option-price.entity';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductTagEntity from '@/features/product/product-tag.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ProductVariantAttributeEntity from '@/features/product/product-variant-attribute.entity';
import TermEntity, { TermTypeEnum } from '@/features/term/term.entity';
import TermContentEntity from '@/features/term/term-content.entity';
import { vatRateService } from '@/features/vat-rate/vat-rate.service';
import { apportion, roundMoney } from '@/helpers/shop.helper';
import type { EntityId } from '@/shared/types/entity-id.type';
import {
	type MeasureUnit,
	MeasureUnitEnum,
	toBaseUnit,
} from '@/shared/types/measure-unit.type';

/**
 * The catalog is seeded in two halves, and they answer different needs.
 *
 * **Curated** products are written out by hand, one entry per real thing being sold: a laptop
 * with two storage variants, a pizza with the crust asked at order time, a menu bundling the
 * pizza with a drink. They are what a page, a filter or a bundle editor is developed against,
 * because every value in them means something and the arithmetic is checkable by eye.
 *
 * **Filler** products fill out the rest of the catalog, so lists, pagination and the facet
 * filters have volume behind them. Each is still a plausible item - its own category, shelf
 * price and description - but the features worth demonstrating (variant axes, reference prices,
 * bundles) live on the curated half.
 *
 * Curated first in the run, so the readable rows carry the low ids.
 */
/**
 * The VAT class a seeded product takes unless it names its own. Goods sold in Romania are
 * `standard` (21% from 2025-08-01); food and drinks without added sugar are `reduced` (11%) and
 * say so on their own entry. A sweetened soft drink (NC 2202) stays standard.
 */
export const DEFAULT_VAT_CATEGORY: ProductVatCategory =
	ProductVatCategoryEnum.STANDARD;

/** A share of a price and the VAT rate it is taxed at - one per component of a bundle. */
type TaxedPart = { weight: number; rate: number };

/**
 * The gross of a net price as pricing computes it: a simple product is `sale` plus its VAT, and a
 * bundle's price is apportioned over its parts by weight with each share taxed at its own rate
 * (`ProductService.attachGrossPrices`).
 */
function grossOf(net: number, parts: readonly TaxedPart[]): number {
	const shares = apportion(
		net,
		parts.map((part) => part.weight),
	);

	return roundMoney(
		net +
			shares.reduce(
				(sum, share, index) =>
					sum + roundMoney((share * parts[index].rate) / 100),
				0,
			),
	);
}

/**
 * The net price whose gross is the shelf figure, at one rate or over a bundle's parts. Not every
 * figure has an exact net - at 11%, 39 lei falls between 38.99 and 39.01; at 21%, so do 21 and
 * 80 - so the closest wins and the shelf would show a ban off. The seeded prices are ones that
 * land exactly.
 */
export function netFromGross(
	gross: number,
	rate: number | readonly TaxedPart[],
): number {
	if (gross === 0) {
		return 0;
	}

	const parts = typeof rate === 'number' ? [{ weight: 1, rate }] : rate;
	const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
	const averageRate =
		weightSum > 0
			? parts.reduce((sum, part) => sum + part.weight * part.rate, 0) /
				weightSum
			: (parts[0]?.rate ?? 0);

	const guess = Math.round((gross * 10000) / (100 + averageRate));

	let best = guess / 100;

	for (const step of [0, -1, 1, -2, 2, -3, 3]) {
		const net = (guess + step) / 100;

		if (grossOf(net, parts) === gross) {
			return net;
		}

		if (
			Math.abs(grossOf(net, parts) - gross) <
			Math.abs(grossOf(best, parts) - gross)
		) {
			best = net;
		}
	}

	return best;
}

/** A generated product: what it is, where it is filed and what it sells for. */
export type FillerProduct = {
	name: string;
	category_slug: string;
	description: string;
	/** The shelf price, VAT included, in RON; stored net (`netFromGross`). */
	gross: number;
	/** The product-scope `color`, where the category asks it. */
	color?: string;
	/** The product-scope `capacity` in millilitres, for the `home-and-garden` items that hold something. */
	capacity?: number;
	/** Offers the extended-warranty question at order time - the electronics worth insuring. */
	warranty?: boolean;
};

/**
 * One generated product per entry, so nothing is listed twice. Every one is goods, so they all
 * take `DEFAULT_VAT_CATEGORY`, and each sells in a single variant: the variant axes worth
 * demonstrating (storage, the size x color grid) live on the curated half.
 */
export const FILLER_PRODUCTS: readonly FillerProduct[] = [
	{
		name: 'Meridian 32 Monitor',
		category_slug: 'monitors',
		description:
			'32-inch 4K IPS monitor with USB-C power delivery and a height-adjustable stand.',
		gross: 2499,
		color: 'black',
		warranty: true,
	},
	{
		name: 'Tessellate Desk Mat',
		category_slug: 'accessories',
		description: 'Felt desk mat, 90 x 40 cm, with a non-slip cork base.',
		gross: 129,
	},
	{
		name: 'Basalt Laptop Stand',
		category_slug: 'accessories',
		description:
			'Aluminium laptop stand with six height settings, folds flat for the bag.',
		gross: 199,
	},
	{
		name: 'Solstice Bookshelf Speaker',
		category_slug: 'speakers',
		description:
			'Pair of powered bookshelf speakers with Bluetooth and an optical input.',
		gross: 879,
		color: 'black',
		warranty: true,
	},
	{
		name: 'Portico Laser Printer',
		category_slug: 'printers',
		description: 'Mono laser printer, 30 pages a minute, duplex and Wi-Fi.',
		gross: 1049,
		color: 'white',
		warranty: true,
	},
	{
		name: 'Vellum Document Scanner',
		category_slug: 'printers',
		description:
			'Duplex sheet-fed scanner, 35 pages a minute, scans straight to PDF.',
		gross: 1299,
		color: 'black',
		warranty: true,
	},
	{
		name: 'Kestrel Webcam',
		category_slug: 'accessories',
		description:
			'1080p webcam with autofocus, a privacy shutter and two microphones.',
		gross: 349,
	},
	{
		name: 'Anvil Cable Sleeve',
		category_slug: 'cables',
		description:
			'Braided sleeve, 1.5 m, that gathers the cables behind a desk.',
		gross: 45,
	},
	{
		name: 'Ferrite Charging Cable',
		category_slug: 'cables',
		description: 'USB-C to USB-C cable, 2 m, 100 W charging.',
		gross: 59,
	},
	{
		name: 'Cobalt Power Strip',
		category_slug: 'accessories',
		description:
			'Six-socket power strip with surge protection and two USB ports.',
		gross: 89,
	},
	{
		name: 'Marlin Docking Station',
		category_slug: 'accessories',
		description:
			'Thunderbolt dock: two displays, Ethernet, card reader and 96 W charging.',
		gross: 949,
		color: 'silver',
		warranty: true,
	},
	{
		name: 'Junction Ethernet Switch',
		category_slug: 'electronics',
		description: 'Eight-port gigabit switch in a fanless metal case.',
		gross: 199,
	},
	{
		name: 'Pallas Studio Microphone',
		category_slug: 'audio',
		description:
			'USB condenser microphone with a cardioid pattern and a headphone output.',
		gross: 649,
		color: 'black',
		warranty: true,
	},
	{
		name: 'Cirrus Air Purifier',
		category_slug: 'home-and-garden',
		description:
			'HEPA air purifier for rooms up to 40 square metres, quiet night mode.',
		gross: 1199,
		color: 'white',
		warranty: true,
	},
	{
		name: 'Thicket Garden Trimmer',
		category_slug: 'power-tools',
		description:
			'Cordless hedge trimmer, 50 cm blade, battery and charger included.',
		gross: 499,
		color: 'green',
		warranty: true,
	},
	{
		name: 'Orbit 24 Monitor',
		category_slug: 'monitors',
		description: '24-inch Full HD monitor, 100 Hz, with a slim bezel.',
		gross: 649,
		color: 'black',
		warranty: true,
	},
	{
		name: 'Cedar Laptop Sleeve',
		category_slug: 'accessories',
		description:
			'Padded sleeve for 14-inch laptops, with a pocket for the charger.',
		gross: 149,
	},
	{
		name: 'Aria Desk Lamp',
		category_slug: 'lighting',
		description:
			'LED desk lamp with dimming, three color temperatures and a USB port.',
		gross: 229,
		color: 'white',
	},
	{
		name: 'Tempo Soundbar',
		category_slug: 'speakers',
		description: '2.1 soundbar with a wireless subwoofer and HDMI eARC.',
		gross: 1399,
		color: 'black',
		warranty: true,
	},
	{
		name: 'Inkwell Inkjet Printer',
		category_slug: 'printers',
		description: 'Colour inkjet all-in-one with refillable ink tanks.',
		gross: 599,
		color: 'white',
		warranty: true,
	},
	{
		name: 'Lumen LED Bulb Pack',
		category_slug: 'lighting',
		description: 'Four E27 LED bulbs, 9 W, warm white.',
		gross: 79,
	},
	{
		name: 'Drift Wireless Earbuds',
		category_slug: 'headphones',
		description:
			'True wireless earbuds with noise cancelling and a wireless charging case.',
		gross: 399,
		color: 'white',
	},
	{
		name: 'Granite Cordless Drill',
		category_slug: 'power-tools',
		description:
			'18 V drill driver with two batteries, a charger and a case.',
		gross: 699,
		color: 'green',
		warranty: true,
	},
	{
		name: 'Brook Watering Can',
		category_slug: 'home-and-garden',
		description: 'Galvanised steel watering can with a brass rose.',
		gross: 65,
		capacity: 5000,
	},
	{
		name: 'Ember Electric Kettle',
		category_slug: 'home-and-garden',
		description: 'Stainless steel kettle with temperature control.',
		gross: 239,
		color: 'silver',
		capacity: 1700,
	},
	{
		name: 'Halyard HDMI Cable',
		category_slug: 'cables',
		description: 'HDMI 2.1 cable, 2 m, rated for 4K at 120 Hz.',
		gross: 65,
	},
	{
		name: 'Vector Gaming Mouse',
		category_slug: 'mice',
		description: 'Wired gaming mouse, 26,000 DPI sensor, 58 g.',
		gross: 299,
		color: 'black',
	},
	{
		name: 'Lattice Low-Profile Keyboard',
		category_slug: 'keyboards',
		description:
			'Wireless low-profile keyboard that pairs with three devices.',
		gross: 399,
		color: 'silver',
	},
	{
		name: 'Beacon Smart Plug',
		category_slug: 'electronics',
		description: 'Wi-Fi smart plug with energy monitoring and schedules.',
		gross: 79,
		color: 'white',
	},
	{
		name: 'Summit Over-Ear Headphones',
		category_slug: 'headphones',
		description:
			'Over-ear wireless headphones with noise cancelling and 40 hours of battery.',
		gross: 949,
		color: 'black',
		warranty: true,
	},
];

/** The extended-warranty answers, at their shelf price (VAT included). */
export const FILLER_WARRANTY: readonly { label: string; gross: number }[] = [
	{ label: 'One extra year', gross: 99 },
	{ label: 'Two extra years', gross: 179 },
];

const FILLER_TARGET = FILLER_PRODUCTS.length;

/** Terms are stored lower-cased, so the seed matches on the same form the term seed writes. */
const termKey = (type: string, value: string): string =>
	`${type}:${value.trim().toLowerCase()}`;

/**
 * The definitions the seeded products answer to.
 *
 * Three scopes are covered on purpose: *Color* asked once for the product and *Storage* asked
 * once per variant are different questions, and the split is what the form uses to place a
 * value. *Diameter* and *Volume* are the numeric case - the number goes in `value_numeric` bare
 * and the unit comes from the definition, which is what makes "between 300 and 600 ml" an
 * indexed comparison.
 *
 * *Spice level* is declared twice, on `pizza` and on `sauces`, because a definition belongs to
 * one category: the same label asked in two places is two rows, and the demo data should show
 * that rather than hide it behind inheritance from a shared parent.
 */
const DEFINITIONS: readonly {
	category_slug: string;
	label: string;
	scope: (typeof ProductCategoryAttributeScopeEnum)[keyof typeof ProductCategoryAttributeScopeEnum];
	value_type: (typeof ProductCategoryAttributeValueTypeEnum)[keyof typeof ProductCategoryAttributeValueTypeEnum];
	type: (typeof ProductCategoryAttributeTypeEnum)[keyof typeof ProductCategoryAttributeTypeEnum];
	unit?: MeasureUnit;
	min_value?: number;
	max_value?: number;
	options?: readonly string[];
	sort_order: number;
}[] = [
	{
		category_slug: 'electronics',
		label: 'color',
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: ['red', 'blue', 'green', 'black', 'silver', 'white'],
		sort_order: 10,
	},
	{
		category_slug: 'electronics',
		label: 'size',
		scope: ProductCategoryAttributeScopeEnum.VARIANT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.RADIO,
		options: ['small', 'medium', 'large'],
		sort_order: 20,
	},
	{
		category_slug: 'electronics',
		label: 'storage',
		scope: ProductCategoryAttributeScopeEnum.VARIANT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.RADIO,
		options: ['256 gb', '512 gb', '1 tb'],
		sort_order: 30,
	},
	{
		category_slug: 'accessories',
		label: 'material',
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: ['cotton', 'leather', 'aluminium'],
		sort_order: 10,
	},
	{
		category_slug: 'home-and-garden',
		label: 'capacity',
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
		type: ProductCategoryAttributeTypeEnum.INPUT,
		unit: MeasureUnitEnum.MILLILITRE,
		min_value: 100,
		max_value: 5000,
		sort_order: 10,
	},
	/*
	 * Apparel is the two-axis case: both *Size* and *Color* are asked per variant, since a
	 * t-shirt is sold as one size in one color and each of those combinations runs out on its
	 * own. Contrast the same *Color* label on `electronics`, asked once for the product -
	 * the scope is what decides which of the two tables a value lands in.
	 */
	{
		category_slug: 't-shirts',
		label: 'size',
		scope: ProductCategoryAttributeScopeEnum.VARIANT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.RADIO,
		options: ['s', 'm', 'l', 'xl'],
		sort_order: 10,
	},
	{
		category_slug: 't-shirts',
		label: 'color',
		scope: ProductCategoryAttributeScopeEnum.VARIANT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: ['white', 'black', 'green', 'red', 'blue'],
		sort_order: 20,
	},
	{
		category_slug: 't-shirts',
		label: 'material',
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: ['cotton'],
		sort_order: 30,
	},
	{
		category_slug: 'pizza',
		label: 'diameter',
		scope: ProductCategoryAttributeScopeEnum.VARIANT,
		value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
		type: ProductCategoryAttributeTypeEnum.INPUT,
		unit: MeasureUnitEnum.CENTIMETRE,
		min_value: 20,
		max_value: 45,
		sort_order: 10,
	},
	{
		category_slug: 'pizza',
		label: 'spice level',
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: ['mild', 'medium', 'hot'],
		sort_order: 20,
	},
	{
		category_slug: 'drinks',
		label: 'volume',
		scope: ProductCategoryAttributeScopeEnum.VARIANT,
		value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
		type: ProductCategoryAttributeTypeEnum.INPUT,
		unit: MeasureUnitEnum.MILLILITRE,
		min_value: 100,
		max_value: 2000,
		sort_order: 10,
	},
	{
		category_slug: 'sauces',
		label: 'spice level',
		scope: ProductCategoryAttributeScopeEnum.PRODUCT,
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: ['mild', 'medium', 'hot'],
		sort_order: 10,
	},
];

/**
 * A shelf price per market, **VAT included** - what a shopper reads, as a Romanian retail price
 * has to be shown. Both currencies are quoted outright, no exchange rate applied; the seed stores
 * each net, at the product's VAT rate (`curatedPricing`).
 */
type Money = { RON: number; EUR: number };

/** A value answering one definition, in whichever of the two forms that definition takes. */
type CuratedAttribute = {
	label: string;
	/** The term wording, for a `term` definition. */
	term?: string;
	/** The bare measurement, for a `number` definition; `unit` is what it is quoted in. */
	value?: number;
	unit?: MeasureUnit;
};

type CuratedVariant = {
	sku: string;
	prices: Money;
	/** Quoted where the demo wants a saving to show; omitted otherwise. */
	reference?: Money;
	attributes?: readonly CuratedAttribute[];
	track_stock?: boolean;
};

/** A question asked at order time, and the answers under it. See `ProductOptionGroupEntity`. */
type CuratedOptionGroup = {
	prompt: string;
	min_select: number;
	max_select: number | null;
	options: readonly {
		label: string;
		/** Signed, against the variant price: an upgrade adds, dropping something takes off. */
		delta: Money;
		is_default?: boolean;
	}[];
};

/**
 * What a bundle contains, named by the component SKUs seeded above it.
 *
 * `charge` is what including the component adds to the bundle price, VAT included - omitted, it
 * adds nothing, the bundle price already covering it. The stored `price_delta` adjusts the
 * component's *own* net price, so the seed writes it as the charge's net less that price
 * (`curatedPricing`).
 */
type CuratedBundle = {
	/** Exactly one candidate is taken from each; two is the fewest that makes it a choice. */
	groups?: readonly {
		prompt: string;
		candidates: readonly {
			sku: string;
			charge?: Money;
			is_default?: boolean;
		}[];
	}[];
	/** Components the bundle simply contains, and the ones the customer may decline. */
	components?: readonly {
		sku: string;
		quantity?: number;
		is_optional?: boolean;
		is_default?: boolean;
		charge?: Money;
	}[];
};

type CuratedProduct = {
	slug: string;
	label: string;
	description: string;
	/** Romanian wording, so the language switcher has a second row to render. */
	ro: { slug: string; label: string; description: string };
	category_slug: string;
	/** Omitted for goods; see `DEFAULT_VAT_CATEGORY`. */
	vat_category?: ProductVatCategory;
	brand?: string;
	tags?: readonly string[];
	workflow?: (typeof ProductWorkflowEnum)[keyof typeof ProductWorkflowEnum];
	attributes?: readonly CuratedAttribute[];
	option_groups?: readonly CuratedOptionGroup[];
	/** Present on a bundle; its own variant is the header line the components hang off. */
	bundle?: CuratedBundle;
	variants: readonly CuratedVariant[];
};

/**
 * The two axes an apparel variant is cut on, and the code each contributes to the SKU.
 *
 * The order here is the order of the grid, so the first pair - `S / white` - is the variant
 * written at position 0 and therefore the default one.
 *
 * Only the largest size carries a surcharge: more fabric, same garment. Sizes below it are
 * priced alike, which is what a size axis usually looks like and keeps the arithmetic on the
 * listing readable.
 */
const TSHIRT_SIZES: readonly {
	term: string;
	code: string;
	surcharge: Money;
}[] = [
	{ term: 's', code: 'S', surcharge: { RON: 0, EUR: 0 } },
	{ term: 'm', code: 'M', surcharge: { RON: 0, EUR: 0 } },
	{ term: 'l', code: 'L', surcharge: { RON: 0, EUR: 0 } },
	{ term: 'xl', code: 'XL', surcharge: { RON: 10, EUR: 2 } },
];

const TSHIRT_COLORS: readonly { term: string; code: string }[] = [
	{ term: 'white', code: 'WHT' },
	{ term: 'black', code: 'BLK' },
	{ term: 'green', code: 'GRN' },
	{ term: 'red', code: 'RED' },
	{ term: 'blue', code: 'BLU' },
];

const TSHIRT_BASE: Money = { RON: 89, EUR: 18 };

/**
 * The full size x color grid - 20 sellable units, each with its own SKU and its own stock.
 *
 * Written out by the loop rather than by hand because the grid is the point: twenty literals
 * would say the same thing while hiding the one rule that governs them, and a missing pair in
 * such a list is invisible. This is the only curated entry generated this way; the rest are
 * literals, because nothing about them repeats.
 */
const tshirtVariants = (): readonly CuratedVariant[] =>
	TSHIRT_SIZES.flatMap((size) =>
		TSHIRT_COLORS.map((color) => ({
			sku: `TSH-SOL-${size.code}-${color.code}`,
			prices: {
				RON: TSHIRT_BASE.RON + size.surcharge.RON,
				EUR: TSHIRT_BASE.EUR + size.surcharge.EUR,
			},
			reference: {
				RON: TSHIRT_BASE.RON + size.surcharge.RON + 20,
				EUR: TSHIRT_BASE.EUR + size.surcharge.EUR + 5,
			},
			attributes: [
				{ label: 'size', term: size.term },
				{ label: 'color', term: color.term },
			],
			track_stock: true,
		})),
	);

/**
 * The catalog worth reading.
 *
 * Order matters twice over: a bundle names its components by SKU, so everything it contains is
 * listed before it, and the ids run in this order, which is what makes the food family sit
 * together in a list sorted by id.
 */
const CURATED: readonly CuratedProduct[] = [
	{
		slug: 'aurora-14-ultrabook',
		label: 'Aurora 14 Ultrabook',
		description:
			'A 14-inch magnesium ultrabook that lasts a working day on a charge.',
		ro: {
			slug: 'ultrabook-aurora-14',
			label: 'Ultrabook Aurora 14',
			description:
				'Ultrabook de 14 inch din magneziu, cu autonomie pentru o zi de lucru.',
		},
		category_slug: 'laptops',
		brand: 'Lenovo',
		tags: ['Best Seller', 'New Arrival'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'color', term: 'silver' }],
		variants: [
			{
				sku: 'AUR14-512',
				prices: { RON: 4949, EUR: 999 },
				reference: { RON: 5449, EUR: 1089 },
				attributes: [{ label: 'storage', term: '512 gb' }],
				track_stock: true,
			},
			{
				sku: 'AUR14-1TB',
				prices: { RON: 5799, EUR: 1159 },
				attributes: [{ label: 'storage', term: '1 tb' }],
				track_stock: true,
			},
		],
	},
	{
		slug: 'meridian-27-monitor',
		label: 'Meridian 27 Monitor',
		description:
			'A 27-inch 4K panel, factory calibrated, on a height-adjustable arm.',
		ro: {
			slug: 'monitor-meridian-27',
			label: 'Monitor Meridian 27',
			description:
				'Panou 4K de 27 inch, calibrat din fabrica, pe brat reglabil.',
		},
		category_slug: 'monitors',
		brand: 'Dell',
		tags: ['Best Seller'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'color', term: 'black' }],
		variants: [
			{
				sku: 'MER27-4K',
				prices: { RON: 1899, EUR: 379 },
				reference: { RON: 2099, EUR: 419 },
				track_stock: true,
			},
		],
	},
	{
		slug: 'halcyon-wireless-headset',
		label: 'Halcyon Wireless Headset',
		description:
			'Over-ear headphones with active noise cancelling and a 40-hour battery.',
		ro: {
			slug: 'casti-wireless-halcyon',
			label: 'Casti wireless Halcyon',
			description:
				'Casti over-ear cu anulare activa a zgomotului si autonomie de 40 de ore.',
		},
		category_slug: 'headphones',
		brand: 'Philips',
		tags: ['New Arrival'],
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'HAL-ANC',
				prices: { RON: 599, EUR: 119 },
				track_stock: true,
			},
		],
	},
	{
		slug: 'northwind-mechanical-keyboard',
		label: 'Northwind Mechanical Keyboard',
		description:
			'A compact mechanical keyboard on an aluminium plate, hot-swappable switches.',
		ro: {
			slug: 'tastatura-mecanica-northwind',
			label: 'Tastatura mecanica Northwind',
			description:
				'Tastatura mecanica compacta pe placa de aluminiu, cu switch-uri interschimbabile.',
		},
		category_slug: 'keyboards',
		brand: 'Logitech',
		tags: ['Best Seller'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'material', term: 'aluminium' }],
		variants: [
			{
				sku: 'NWK-65',
				prices: { RON: 439, EUR: 89 },
				track_stock: true,
			},
		],
	},
	{
		slug: 'quill-bluetooth-mouse',
		label: 'Quill Bluetooth Mouse',
		description:
			'A quiet six-button mouse that pairs with three machines at once.',
		ro: {
			slug: 'mouse-bluetooth-quill',
			label: 'Mouse Bluetooth Quill',
			description:
				'Mouse silentios cu sase butoane, conectat simultan la trei dispozitive.',
		},
		category_slug: 'mice',
		brand: 'Logitech',
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'material', term: 'cotton' }],
		variants: [
			{
				sku: 'QUI-BT6',
				prices: { RON: 179, EUR: 34.5 },
				track_stock: true,
			},
		],
	},
	{
		slug: 'cascade-usb-c-hub',
		label: 'Cascade USB-C Hub',
		description:
			'Seven ports off one cable: HDMI, card reader and 100 W pass-through charging.',
		ro: {
			slug: 'hub-usb-c-cascade',
			label: 'Hub USB-C Cascade',
			description:
				'Sapte porturi pe un singur cablu: HDMI, cititor de carduri si incarcare 100 W.',
		},
		category_slug: 'cables',
		brand: 'Anker',
		tags: ['Best Seller'],
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'CAS-HUB7',
				prices: { RON: 239, EUR: 48 },
				track_stock: true,
			},
		],
	},
	/*
	 * The variant grid. Size and color are both variant axes - each pair has its own SKU, its
	 * own price row and its own count on the shelf - while gift wrap and the back print are
	 * asked at order time and change nothing that runs out.
	 */
	{
		slug: 'solstice-cotton-t-shirt',
		label: 'Solstice Cotton T-Shirt',
		description:
			'A heavyweight combed-cotton tee with a ribbed collar, in four sizes and five colors.',
		ro: {
			slug: 'tricou-din-bumbac-solstice',
			label: 'Tricou din bumbac Solstice',
			description:
				'Tricou din bumbac pieptanat, cu guler reiat, in patru marimi si cinci culori.',
		},
		category_slug: 't-shirts',
		tags: ['Summer', 'New Arrival'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'material', term: 'cotton' }],
		option_groups: [
			{
				prompt: 'Finishing touches',
				min_select: 0,
				max_select: null,
				options: [
					{ label: 'Gift wrap', delta: { RON: 15, EUR: 3 } },
					{
						label: 'Custom back print',
						delta: { RON: 40, EUR: 8 },
					},
				],
			},
		],
		variants: tshirtVariants(),
	},
	{
		slug: 'margherita-pizza',
		label: 'Margherita Pizza',
		description:
			'San Marzano tomatoes, fior di latte and basil on a stone-baked base.',
		ro: {
			slug: 'pizza-margherita',
			label: 'Pizza Margherita',
			description:
				'Rosii San Marzano, fior di latte si busuioc pe blat copt pe piatra.',
		},
		category_slug: 'pizza',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['Vegetarian', 'Best Seller'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'spice level', term: 'mild' }],
		option_groups: [
			{
				prompt: 'Choose your crust',
				min_select: 1,
				max_select: 1,
				options: [
					{
						label: 'Classic crust',
						delta: { RON: 0, EUR: 0 },
						is_default: true,
					},
					{ label: 'Thin crust', delta: { RON: 0, EUR: 0 } },
					{ label: 'Sourdough crust', delta: { RON: 5, EUR: 1 } },
				],
			},
			{
				prompt: 'Extra toppings',
				min_select: 0,
				max_select: null,
				options: [
					{ label: 'Extra cheese', delta: { RON: 7, EUR: 1.5 } },
					{ label: 'Mushrooms', delta: { RON: 5, EUR: 1 } },
					{ label: 'Olives', delta: { RON: 5, EUR: 1 } },
				],
			},
		],
		variants: [
			{
				sku: 'PIZ-MAR-25',
				prices: { RON: 35, EUR: 7.5 },
				attributes: [
					{
						label: 'diameter',
						value: 25,
						unit: MeasureUnitEnum.CENTIMETRE,
					},
				],
			},
			{
				sku: 'PIZ-MAR-32',
				prices: { RON: 45, EUR: 9.5 },
				attributes: [
					{
						label: 'diameter',
						value: 32,
						unit: MeasureUnitEnum.CENTIMETRE,
					},
				],
			},
		],
	},
	{
		slug: 'diavola-pizza',
		label: 'Diavola Pizza',
		description: 'Spicy salami, chilli and mozzarella, baked hot and fast.',
		ro: {
			slug: 'pizza-diavola',
			label: 'Pizza Diavola',
			description:
				'Salam picant, ardei iute si mozzarella, coapta rapid.',
		},
		category_slug: 'pizza',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['Spicy'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'spice level', term: 'hot' }],
		option_groups: [
			{
				prompt: 'Choose your crust',
				min_select: 1,
				max_select: 1,
				options: [
					{
						label: 'Classic crust',
						delta: { RON: 0, EUR: 0 },
						is_default: true,
					},
					{ label: 'Thin crust', delta: { RON: 0, EUR: 0 } },
					{ label: 'Sourdough crust', delta: { RON: 5, EUR: 1 } },
				],
			},
			{
				prompt: 'Extra toppings',
				min_select: 0,
				max_select: null,
				options: [
					{ label: 'Extra cheese', delta: { RON: 7, EUR: 1.5 } },
					{ label: 'Pepperoni', delta: { RON: 8, EUR: 1.5 } },
					{ label: 'Olives', delta: { RON: 5, EUR: 1 } },
				],
			},
		],
		variants: [
			{
				sku: 'PIZ-DIA-25',
				prices: { RON: 42, EUR: 8.5 },
				attributes: [
					{
						label: 'diameter',
						value: 25,
						unit: MeasureUnitEnum.CENTIMETRE,
					},
				],
			},
			{
				sku: 'PIZ-DIA-32',
				prices: { RON: 52, EUR: 10.5 },
				attributes: [
					{
						label: 'diameter',
						value: 32,
						unit: MeasureUnitEnum.CENTIMETRE,
					},
				],
			},
		],
	},
	{
		slug: 'quattro-formaggi-pizza',
		label: 'Quattro Formaggi Pizza',
		description:
			'Mozzarella, gorgonzola, pecorino and taleggio, finished with honey.',
		ro: {
			slug: 'pizza-quattro-formaggi',
			label: 'Pizza Quattro Formaggi',
			description:
				'Mozzarella, gorgonzola, pecorino si taleggio, finisata cu miere.',
		},
		category_slug: 'pizza',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['Vegetarian'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'spice level', term: 'mild' }],
		option_groups: [
			{
				prompt: 'Choose your crust',
				min_select: 1,
				max_select: 1,
				options: [
					{
						label: 'Classic crust',
						delta: { RON: 0, EUR: 0 },
						is_default: true,
					},
					{ label: 'Thin crust', delta: { RON: 0, EUR: 0 } },
				],
			},
		],
		variants: [
			{
				sku: 'PIZ-QUA-32',
				prices: { RON: 55, EUR: 11 },
				attributes: [
					{
						label: 'diameter',
						value: 32,
						unit: MeasureUnitEnum.CENTIMETRE,
					},
				],
			},
		],
	},
	{
		slug: 'cola-can',
		label: 'Cola',
		description: 'Chilled cola in a 330 ml can.',
		ro: {
			slug: 'cola-doza',
			label: 'Cola',
			description: 'Cola rece la doza de 330 ml.',
		},
		category_slug: 'drinks',
		// A sweetened soft drink (NC 2202) stays at the standard rate
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'DRK-COLA-330',
				prices: { RON: 9, EUR: 2 },
				attributes: [
					{
						label: 'volume',
						value: 330,
						unit: MeasureUnitEnum.MILLILITRE,
					},
				],
			},
		],
	},
	{
		slug: 'sparkling-water',
		label: 'Sparkling Water',
		description: 'Naturally carbonated mineral water, 500 ml bottle.',
		ro: {
			slug: 'apa-minerala',
			label: 'Apa minerala',
			description: 'Apa minerala natural carbogazoasa, sticla de 500 ml.',
		},
		category_slug: 'drinks',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['Eco Friendly'],
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'DRK-WATER-500',
				prices: { RON: 8, EUR: 1.5 },
				attributes: [
					{
						label: 'volume',
						value: 500,
						unit: MeasureUnitEnum.MILLILITRE,
					},
				],
			},
		],
	},
	{
		slug: 'orange-juice',
		label: 'Orange Juice',
		description: 'Freshly pressed orange juice, 250 ml.',
		ro: {
			slug: 'suc-de-portocale',
			label: 'Suc de portocale',
			description: 'Suc de portocale stors proaspat, 250 ml.',
		},
		category_slug: 'drinks',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['New Arrival'],
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'DRK-JUICE-250',
				prices: { RON: 12, EUR: 2.5 },
				attributes: [
					{
						label: 'volume',
						value: 250,
						unit: MeasureUnitEnum.MILLILITRE,
					},
				],
			},
		],
	},
	{
		slug: 'garlic-dip',
		label: 'Garlic Dip',
		description: 'Cold garlic and yoghurt dip, 50 ml pot.',
		ro: {
			slug: 'sos-de-usturoi',
			label: 'Sos de usturoi',
			description: 'Sos rece de usturoi cu iaurt, cupa de 50 ml.',
		},
		category_slug: 'sauces',
		vat_category: ProductVatCategoryEnum.REDUCED,
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'spice level', term: 'mild' }],
		variants: [
			{
				sku: 'SAU-GARLIC-50',
				prices: { RON: 5, EUR: 1 },
			},
		],
	},
	{
		slug: 'chilli-sauce',
		label: 'Chilli Sauce',
		description: 'Fermented chilli sauce with a long finish, 50 ml pot.',
		ro: {
			slug: 'sos-iute',
			label: 'Sos iute',
			description: 'Sos de ardei iute fermentat, cupa de 50 ml.',
		},
		category_slug: 'sauces',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['Spicy'],
		workflow: ProductWorkflowEnum.READY,
		attributes: [{ label: 'spice level', term: 'hot' }],
		variants: [
			{
				sku: 'SAU-CHILLI-50',
				prices: { RON: 5, EUR: 1 },
			},
		],
	},

	/*
	 * The bundles. Each is cheaper than its parts bought alone - the reference says by how much -
	 * and a pricier alternative or an extra states what it adds as its `charge`.
	 */
	{
		slug: 'pizza-night-menu',
		label: 'Pizza Night Menu',
		description:
			'A 32 cm pizza and a drink, with a dip on the side if you want one.',
		ro: {
			slug: 'meniu-pizza-night',
			label: 'Meniu Pizza Night',
			description:
				'O pizza de 32 cm si o bautura, cu un sos alaturi daca vrei.',
		},
		category_slug: 'pizza',
		vat_category: ProductVatCategoryEnum.REDUCED,
		tags: ['Best Seller'],
		workflow: ProductWorkflowEnum.READY,
		bundle: {
			groups: [
				{
					prompt: 'Choose your pizza',
					candidates: [
						{ sku: 'PIZ-MAR-32', is_default: true },
						// 52 alone against the Margherita's 45: the menu asks 5 of the 7
						{ sku: 'PIZ-DIA-32', charge: { RON: 5, EUR: 1 } },
					],
				},
				{
					prompt: 'Choose your drink',
					candidates: [
						{ sku: 'DRK-COLA-330', is_default: true },
						// 12 alone against the cola's 9
						{ sku: 'DRK-JUICE-250', charge: { RON: 3, EUR: 0.5 } },
					],
				},
			],
			components: [
				{
					sku: 'SAU-GARLIC-50',
					is_optional: true,
					is_default: true,
					// 3 against 5 bought alone
					charge: { RON: 3, EUR: 0.6 },
				},
			],
		},
		variants: [
			{
				sku: 'MENU-PIZZA-NIGHT',
				prices: { RON: 49, EUR: 10 },
				// What the default pizza and drink cost bought separately
				reference: { RON: 54, EUR: 11.5 },
			},
		],
	},
	{
		slug: 'desk-starter-kit',
		label: 'Desk Starter Kit',
		description:
			'Keyboard and mouse together, with the hub if the desk needs the ports.',
		ro: {
			slug: 'kit-birou',
			label: 'Kit de birou',
			description:
				'Tastatura si mouse impreuna, cu hub daca biroul are nevoie de porturi.',
		},
		category_slug: 'accessories',
		brand: 'Logitech',
		tags: ['Clearance'],
		workflow: ProductWorkflowEnum.READY,
		bundle: {
			components: [
				{ sku: 'NWK-65' },
				{ sku: 'QUI-BT6' },
				{
					sku: 'CAS-HUB7',
					is_optional: true,
					// 199 against 239 bought alone
					charge: { RON: 199, EUR: 39 },
				},
			],
		},
		variants: [
			{
				sku: 'KIT-DESK',
				prices: { RON: 539, EUR: 108 },
				// What the keyboard and mouse cost bought separately
				reference: { RON: 618, EUR: 123.5 },
			},
		],
	},
];

/** The money columns the seed writes, worked out from the shelf figures in `CURATED`. */
export type CuratedPricing = ReturnType<typeof curatedPricing>;

/**
 * Turns `CURATED`'s shelf figures into the net values the rows store, at the rates `vatRate`
 * answers - the deployment's own, read from `vat_rate`.
 *
 * - A variant, reference or option figure is netted at its product's rate.
 * - A bundle component's `price_delta` adjusts the component's own net price, so it is the
 *   charge's net less that price: a component the bundle price already covers gives its whole price
 *   back and adds nothing.
 * - A bundle's own price is apportioned over its default kit (`attachGrossPrices`) and each
 *   share taxed at its component's rate, so it is netted over those parts together.
 */
export function curatedPricing(
	vatRate: (category: ProductVatCategory) => number,
) {
	const bySku = new Map(
		CURATED.flatMap((entry) =>
			entry.variants.map((spec) => [spec.sku, { entry, spec }] as const),
		),
	);

	const lookup = (sku: string) => {
		const found = bySku.get(sku);

		if (!found) {
			throw new Error(`No curated variant "${sku}"`);
		}

		return found;
	};

	const rateOf = (entry: CuratedProduct): number =>
		vatRate(entry.vat_category ?? DEFAULT_VAT_CATEGORY);

	/** The parts the price of variant `sku` is taxed over: one for a product, its kit for a bundle. */
	const partsOf = (sku: string, currency: keyof Money): TaxedPart[] => {
		const { entry } = lookup(sku);

		if (entry.bundle) {
			const kit: { sku: string; units: number }[] = [
				...(entry.bundle.groups ?? []).map((group) => ({
					sku: (
						group.candidates.find(
							(candidate) => candidate.is_default,
						) ?? group.candidates[0]
					).sku,
					units: 1,
				})),
				...(entry.bundle.components ?? [])
					.filter((component) => !component.is_optional)
					.map((component) => ({
						sku: component.sku,
						units: component.quantity ?? 1,
					})),
			];

			return kit.map((part) => ({
				weight: variantNet(part.sku, currency) * part.units,
				rate: rateOf(lookup(part.sku).entry),
			}));
		}

		return [{ weight: 1, rate: rateOf(entry) }];
	};

	const variantNet = (sku: string, currency: keyof Money): number =>
		netFromGross(lookup(sku).spec.prices[currency], partsOf(sku, currency));

	return {
		variantNet,
		/**
		 * Pricing grosses a reference by the sale price's own ratio (`reference * saleGross /
		 * sale`), not by its rate, so the net is the one that ratio scales onto the shelf figure.
		 */
		referenceNet: (sku: string, currency: keyof Money): number | null => {
			const figure = lookup(sku).spec.reference?.[currency];

			if (figure === undefined) {
				return null;
			}

			const sale = variantNet(sku, currency);
			const ratio = grossOf(sale, partsOf(sku, currency)) / sale;
			const guess = Math.round((figure / ratio) * 100);

			for (const step of [0, -1, 1, -2, 2]) {
				const net = (guess + step) / 100;

				if (roundMoney(net * ratio) === figure) {
					return net;
				}
			}

			return guess / 100;
		},
		optionDelta: (
			entry: CuratedProduct,
			delta: Money,
			currency: keyof Money,
		): number => netFromGross(delta[currency], rateOf(entry)),
		bundleItemDelta: (
			sku: string,
			charge: Money | undefined,
			currency: keyof Money,
		): number =>
			roundMoney(
				netFromGross(
					charge?.[currency] ?? 0,
					rateOf(lookup(sku).entry),
				) - variantNet(sku, currency),
			),
	};
}

export const productSeed: SeedDefinition = {
	name: 'product',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const productRepository = manager.getRepository(ProductEntity);
		const contentRepository = manager.getRepository(ProductContentEntity);
		const categoryLinkRepository = manager.getRepository(
			ProductCategoryEntity,
		);
		const tagLinkRepository = manager.getRepository(ProductTagEntity);
		const variantRepository = manager.getRepository(ProductVariantEntity);
		const priceRepository = manager.getRepository(ProductPriceEntity);
		const attributeRepository = manager.getRepository(
			ProductAttributeEntity,
		);
		const variantAttributeRepository = manager.getRepository(
			ProductVariantAttributeEntity,
		);
		const availabilityRepository = manager.getRepository(
			ProductAvailabilityEntity,
		);
		const optionGroupRepository = manager.getRepository(
			ProductOptionGroupEntity,
		);
		const optionRepository = manager.getRepository(ProductOptionEntity);
		const optionPriceRepository = manager.getRepository(
			ProductOptionPriceEntity,
		);
		const bundleGroupRepository = manager.getRepository(
			ProductBundleGroupEntity,
		);
		const bundleItemRepository = manager.getRepository(
			ProductBundleItemEntity,
		);
		const bundleItemPriceRepository = manager.getRepository(
			ProductBundleItemPriceEntity,
		);
		const definitionRepository = manager.getRepository(
			ProductCategoryAttributeEntity,
		);
		const definitionOptionRepository = manager.getRepository(
			ProductCategoryAttributeOptionEntity,
		);

		const categoryContents = await manager
			.getRepository(CategoryContentEntity)
			.find({
				select: { category_id: true, slug: true },
				where: { language: 'en' },
			});

		const categoryIdBySlug = new Map(
			categoryContents.map((content) => [
				content.slug,
				content.category_id,
			]),
		);

		const brands = await manager.getRepository(BrandEntity).find({
			select: { id: true, name: true },
		});

		const brandIdByName = new Map(
			brands.map((brand) => [brand.name, brand.id]),
		);

		const brandIds = await loadIds(manager, BrandEntity);

		// The term id behind each label and value, keyed by type plus wording - the seed states
		// the vocabulary in words and the tables store ids
		const termContents = await manager
			.getRepository(TermContentEntity)
			.find({
				select: { term_id: true, value: true },
				where: { language: 'en' },
				relations: { term: true },
			});

		const termIdByKey = new Map(
			termContents
				.filter((content) => content.term)
				.map((content) => [
					termKey(content.term.type, content.value),
					content.term_id,
				]),
		);

		const labelId = (label: string): EntityId | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.ATTRIBUTE_LABEL, label));

		const valueId = (value: string): EntityId | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.ATTRIBUTE_VALUE, value));

		/** An order-time prompt or answer, which is free wording rather than vocabulary. */
		const textId = (value: string): EntityId | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.TEXT, value));

		/** The question a bundle choice asks, from the terms seeded for exactly that. */
		const promptId = (prompt: string): EntityId | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.BUNDLE_CHOICE, prompt));

		/** A tag by its wording. Keyed folded, since a tag is stored lower-cased. */
		const tagId = (tag: string): EntityId | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.TAG, tag));

		const tagIds = await loadIds(manager, TermEntity, {
			type: TermTypeEnum.TAG,
		});

		/*
		 * The definitions come first: a product attribute is only meaningful against the
		 * definition that governs its label, and the resolve endpoint has nothing to answer
		 * with until they exist.
		 */
		const existingDefinitions = await definitionRepository.find({
			select: { category_id: true, attribute_label_id: true },
			withDeleted: true,
		});

		const definedKeys = new Set(
			existingDefinitions.map(
				(row) => `${row.category_id}:${row.attribute_label_id}`,
			),
		);

		for (const row of DEFINITIONS) {
			const category_id = categoryIdBySlug.get(row.category_slug);
			const attribute_label_id = labelId(row.label);

			if (!category_id || !attribute_label_id) {
				continue;
			}

			if (definedKeys.has(`${category_id}:${attribute_label_id}`)) {
				continue;
			}

			const definition = await definitionRepository.save(
				definitionRepository.create({
					category_id,
					attribute_label_id,
					scope: row.scope,
					value_type: row.value_type,
					type: row.type,
					unit: row.unit ?? null,
					min_value: row.min_value ?? null,
					max_value: row.max_value ?? null,
					is_required: false,
					is_filterable: true,
					inherit: true,
					sort_order: row.sort_order,
				}),
			);

			const options = (row.options ?? [])
				.map((value, index) => ({
					term_id: valueId(value),
					sort_order: (index + 1) * 10,
				}))
				.filter((option) => option.term_id !== undefined);

			if (options.length) {
				await definitionOptionRepository.save(
					options.map((option) =>
						definitionOptionRepository.create({
							attribute_id: definition.id,
							term_id: option.term_id as EntityId,
							sort_order: option.sort_order,
						}),
					),
				);
			}

			definedKeys.add(`${category_id}:${attribute_label_id}`);
		}

		/*
		 * The slug lives on the content row, so that is where the natural key is read from - the
		 * product itself carries no code of its own. Same shape as `article.seed.ts`.
		 */
		const existingContent = await contentRepository.find({
			select: { slug: true },
		});

		const existingSlugs = new Set(
			existingContent.map((content) => content.slug),
		);

		/** Every curated variant written in this run, so a bundle can name its components. */
		const variantIdBySku = new Map<string, EntityId>();

		let alreadyPresent = 0;
		let inserted = 0;

		// Every price in the seed is a shelf figure; the rows store it net, at the deployment's rates
		const vatRate = await vatRateService.resolverFor();
		const pricing = curatedPricing(vatRate);

		/** One price row per market, from the sale price and whatever else the entry quotes. */
		const savePrices = async (
			variant_id: EntityId,
			sku: string,
		): Promise<void> => {
			await priceRepository.save(
				(['RON', 'EUR'] as const).map((currency) => {
					const salePrice = pricing.variantNet(sku, currency);

					return priceRepository.create({
						variant_id,
						currency,
						sale_price: salePrice,
						reference_price: pricing.referenceNet(sku, currency),
						// The floor a discount may not drop below - 20% off the sale price
						min_price: Number((salePrice * 0.8).toFixed(2)),
					});
				}),
			);
		};

		/**
		 * One attribute value, written to whichever table its scope belongs to. A numeric value
		 * also carries `value_base`, the figure converted into its dimension's base unit - the
		 * same conversion the service applies on write, and what a range filter compares.
		 */
		const saveAttribute = async (
			owner: { product_id: EntityId } | { variant_id: EntityId },
			attribute: CuratedAttribute,
		): Promise<void> => {
			const attribute_label_id = labelId(attribute.label);

			if (!attribute_label_id) {
				return;
			}

			if (attribute.term !== undefined) {
				const value_term_id = valueId(attribute.term);

				if (!value_term_id) {
					return;
				}

				if ('product_id' in owner) {
					await attributeRepository.save(
						attributeRepository.create({
							product_id: owner.product_id,
							attribute_label_id,
							value_term_id,
						}),
					);

					return;
				}

				await variantAttributeRepository.save(
					variantAttributeRepository.create({
						variant_id: owner.variant_id,
						attribute_label_id,
						value_term_id,
					}),
				);

				return;
			}

			if (attribute.value === undefined) {
				return;
			}

			const value = {
				value_numeric: attribute.value,
				value_base: toBaseUnit(attribute.value, attribute.unit ?? null),
			};

			if ('product_id' in owner) {
				await attributeRepository.save(
					attributeRepository.create({
						product_id: owner.product_id,
						attribute_label_id,
						...value,
					}),
				);

				return;
			}

			await variantAttributeRepository.save(
				variantAttributeRepository.create({
					variant_id: owner.variant_id,
					attribute_label_id,
					...value,
				}),
			);
		};

		for (const entry of CURATED) {
			if (existingSlugs.has(entry.slug)) {
				alreadyPresent++;
				continue;
			}

			const isBundle = entry.bundle !== undefined;

			const product = await productRepository.save(
				productRepository.create({
					workflow: entry.workflow ?? ProductWorkflowEnum.READY,
					sale_status: ProductSaleStatusEnum.AVAILABLE,
					type: ProductTypeEnum.PHYSICAL,
					composition: isBundle
						? ProductCompositionEnum.BUNDLE
						: ProductCompositionEnum.SIMPLE,
					unit: ProductUnitEnum.PIECE,
					vat_category: entry.vat_category ?? DEFAULT_VAT_CATEGORY,
					// A bundle names no brand: what it contains comes from several of them
					brand_id: isBundle
						? null
						: (brandIdByName.get(entry.brand ?? '') ?? null),
				}),
			);

			await contentRepository.save([
				contentRepository.create({
					product_id: product.id,
					language: 'en',
					slug: entry.slug,
					label: entry.label,
					description: entry.description,
					meta: {
						title: entry.label,
						description: entry.description,
					},
				}),
				contentRepository.create({
					product_id: product.id,
					language: 'ro',
					slug: entry.ro.slug,
					label: entry.ro.label,
					description: entry.ro.description,
					meta: {
						title: entry.ro.label,
						description: entry.ro.description,
					},
				}),
			]);

			const category_id = categoryIdBySlug.get(entry.category_slug);

			if (category_id) {
				await categoryLinkRepository.save(
					categoryLinkRepository.create({
						product_id: product.id,
						category_id,
					}),
				);
			}

			const tagLinks = (entry.tags ?? [])
				.map((tag) => tagId(tag))
				.filter((tag_id): tag_id is EntityId => tag_id !== undefined);

			if (tagLinks.length) {
				await tagLinkRepository.save(
					tagLinks.map((tag_id) =>
						tagLinkRepository.create({
							product_id: product.id,
							tag_id,
						}),
					),
				);
			}

			for (const attribute of entry.attributes ?? []) {
				await saveAttribute({ product_id: product.id }, attribute);
			}

			for (const [position, spec] of entry.variants.entries()) {
				const variant = await variantRepository.save(
					variantRepository.create({
						product_id: product.id,
						sku: spec.sku,
						position,
						is_default: position === 0,
						/*
						 * A bundle holds no stock of its own - availability is the minimum over
						 * its components - and that flag is also what keeps its header line out
						 * of shipment allocation.
						 */
						track_stock: isBundle
							? false
							: (spec.track_stock ?? false),
						low_stock_threshold:
							!isBundle && spec.track_stock ? 5 : null,
						allow_backorder: false,
						// Roughly what the shop paid for it
						cost_price: Number(
							(pricing.variantNet(spec.sku, 'RON') * 0.6).toFixed(
								2,
							),
						),
					}),
				);

				variantIdBySku.set(spec.sku, variant.id);

				await savePrices(variant.id, spec.sku);

				for (const attribute of spec.attributes ?? []) {
					await saveAttribute({ variant_id: variant.id }, attribute);
				}
			}

			for (const [position, group] of (
				entry.option_groups ?? []
			).entries()) {
				const label_id = textId(group.prompt);

				if (!label_id) {
					continue;
				}

				const optionGroup = await optionGroupRepository.save(
					optionGroupRepository.create({
						product_id: product.id,
						label_id,
						min_select: group.min_select,
						max_select: group.max_select,
						position,
					}),
				);

				for (const [
					optionPosition,
					option,
				] of group.options.entries()) {
					const optionLabelId = textId(option.label);

					if (!optionLabelId) {
						continue;
					}

					const saved = await optionRepository.save(
						optionRepository.create({
							option_group_id: optionGroup.id,
							label_id: optionLabelId,
							position: optionPosition,
							is_default: option.is_default ?? false,
						}),
					);

					await optionPriceRepository.save(
						(['RON', 'EUR'] as const).map((currency) =>
							optionPriceRepository.create({
								option_id: saved.id,
								currency,
								// Signed: declining an upgrade legitimately reduces the price
								price_delta: pricing.optionDelta(
									entry,
									option.delta,
									currency,
								),
							}),
						),
					);
				}
			}

			if (entry.bundle) {
				let position = 0;

				for (const [groupPosition, group] of (
					entry.bundle.groups ?? []
				).entries()) {
					const label_id = promptId(group.prompt);

					if (!label_id) {
						continue;
					}

					const bundleGroup = await bundleGroupRepository.save(
						bundleGroupRepository.create({
							product_id: product.id,
							label_id,
							position: groupPosition,
						}),
					);

					for (const candidate of group.candidates) {
						const variant_id = variantIdBySku.get(candidate.sku);

						if (!variant_id) {
							throw new Error(
								`Bundle "${entry.slug}" names unknown component "${candidate.sku}"`,
							);
						}

						const item = await bundleItemRepository.save(
							bundleItemRepository.create({
								product_id: product.id,
								variant_id,
								quantity: 1,
								position: position++,
								group_id: bundleGroup.id,
								// Refused inside a group: the group decides how many
								// candidates are taken, and it always takes exactly one
								is_optional: false,
								is_default: candidate.is_default ?? false,
							}),
						);

						await bundleItemPriceRepository.save(
							(['RON', 'EUR'] as const).map((currency) =>
								bundleItemPriceRepository.create({
									item_id: item.id,
									currency,
									price_delta: pricing.bundleItemDelta(
										candidate.sku,
										candidate.charge,
										currency,
									),
								}),
							),
						);
					}
				}

				for (const component of entry.bundle.components ?? []) {
					const variant_id = variantIdBySku.get(component.sku);

					if (!variant_id) {
						throw new Error(
							`Bundle "${entry.slug}" names unknown component "${component.sku}"`,
						);
					}

					const item = await bundleItemRepository.save(
						bundleItemRepository.create({
							product_id: product.id,
							variant_id,
							quantity: component.quantity ?? 1,
							position: position++,
							is_optional: component.is_optional ?? false,
							is_default: component.is_default ?? false,
						}),
					);

					if (component.charge) {
						await bundleItemPriceRepository.save(
							(['RON', 'EUR'] as const).map((currency) =>
								bundleItemPriceRepository.create({
									item_id: item.id,
									currency,
									price_delta: pricing.bundleItemDelta(
										component.sku,
										component.charge,
										currency,
									),
								}),
							),
						);
					}
				}
			}

			existingSlugs.add(entry.slug);
			inserted++;
		}

		/*
		 * The generated half. Simple products only: a bundle is worth reading rather than
		 * counting, so the curated menus above are the only ones, and the filler exists purely
		 * to give the lists and the facets rows to work with.
		 */
		const warrantyPromptId = textId('Extended warranty');

		for (const [index, spec] of FILLER_PRODUCTS.entries()) {
			const slug = `product-${sequenceLabel(index)}`;

			if (existingSlugs.has(slug)) {
				alreadyPresent++;
				continue;
			}

			const variantSku = `PRD-${sequenceLabel(index)}`;

			const product = await productRepository.save(
				productRepository.create({
					workflow: randomPick(random, [
						ProductWorkflowEnum.DRAFT,
						ProductWorkflowEnum.PENDING_REVIEW,
						ProductWorkflowEnum.READY,
						ProductWorkflowEnum.READY,
					]),
					sale_status: ProductSaleStatusEnum.AVAILABLE,
					type: ProductTypeEnum.PHYSICAL,
					composition: ProductCompositionEnum.SIMPLE,
					unit: ProductUnitEnum.PIECE,
					vat_category: DEFAULT_VAT_CATEGORY,
					brand_id: brandIds.length
						? randomPick(random, brandIds)
						: null,
				}),
			);

			await contentRepository.save(
				contentRepository.create({
					product_id: product.id,
					language: 'en',
					slug,
					label: spec.name,
					description: spec.description,
					meta: {
						title: spec.name,
						description: spec.description,
					},
				}),
			);

			const category_id = categoryIdBySlug.get(spec.category_slug);

			if (category_id) {
				await categoryLinkRepository.save(
					categoryLinkRepository.create({
						product_id: product.id,
						category_id,
					}),
				);
			}

			if (tagIds.length) {
				// A set, because two picks can land on the same tag and the link table holds a
				// unique index on (product_id, tag_id)
				const picked = new Set(
					Array.from({ length: randomInt(random, 1, 3) }, () =>
						randomPick(random, tagIds),
					),
				);

				await tagLinkRepository.save(
					Array.from(picked, (tag_id) =>
						tagLinkRepository.create({
							product_id: product.id,
							tag_id,
						}),
					),
				);
			}

			const rate = vatRate(DEFAULT_VAT_CATEGORY);
			const salePrice = netFromGross(spec.gross, rate);

			const variant = await variantRepository.save(
				variantRepository.create({
					product_id: product.id,
					sku: `${variantSku}-V1`,
					position: 0,
					is_default: true,
					track_stock: index % 3 === 0,
					low_stock_threshold: index % 3 === 0 ? 5 : null,
					allow_backorder: false,
					cost_price: Number((salePrice * 0.6).toFixed(2)),
				}),
			);

			// Filler is quoted in the app currency alone, with no reference price; the curated
			// half is what carries a second market and a saving to show
			await priceRepository.save(
				priceRepository.create({
					variant_id: variant.id,
					currency: 'RON',
					sale_price: salePrice,
					reference_price: null,
					min_price: Number((salePrice * 0.8).toFixed(2)),
				}),
			);

			if (spec.color) {
				await saveAttribute(
					{ product_id: product.id },
					{ label: 'color', term: spec.color },
				);
			}

			if (spec.capacity !== undefined) {
				await saveAttribute(
					{ product_id: product.id },
					{
						label: 'capacity',
						value: spec.capacity,
						unit: MeasureUnitEnum.MILLILITRE,
					},
				);
			}

			// Every seventh product is orderable on weekday lunchtimes only, so the recurring
			// window branch has rows without every product wearing one. The days are ISO 8601,
			// 1 = Monday, so 1–5 is Monday through Friday
			if (index % 7 === 0) {
				await availabilityRepository.save(
					[1, 2, 3, 4, 5].map((day_of_week) =>
						availabilityRepository.create({
							product_id: product.id,
							day_of_week,
							starts_at: '12:00:00',
							ends_at: '15:00:00',
						}),
					),
				);
			}

			// The electronics worth insuring ask about an extended warranty at order time.
			// `min_select` 0 and `max_select` 1 is the optional single choice
			if (spec.warranty && warrantyPromptId) {
				const group = await optionGroupRepository.save(
					optionGroupRepository.create({
						product_id: product.id,
						label_id: warrantyPromptId,
						min_select: 0,
						max_select: 1,
						position: 0,
					}),
				);

				for (const [optionIndex, option] of FILLER_WARRANTY.entries()) {
					const optionTermId = textId(option.label);

					if (!optionTermId) {
						continue;
					}

					const saved = await optionRepository.save(
						optionRepository.create({
							option_group_id: group.id,
							label_id: optionTermId,
							position: optionIndex,
							is_default: false,
						}),
					);

					await optionPriceRepository.save(
						optionPriceRepository.create({
							option_id: saved.id,
							currency: 'RON',
							// A delta is taxed with the line it joins, so it is net like the price
							price_delta: netFromGross(option.gross, rate),
						}),
					);
				}
			}

			existingSlugs.add(slug);
			inserted++;
		}

		const target = CURATED.length + FILLER_TARGET;

		return {
			entity: 'product',
			alreadyPresent,
			inserted,
			target,
			tableTotal: await productRepository.count({ withDeleted: true }),
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(productSeed);
}
