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
import CategoryEntity, {
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import CategoryContentEntity from '@/features/category/category-content.entity';
import ProductEntity, {
	ProductCompositionEnum,
	ProductSaleStatusEnum,
	ProductTypeEnum,
	ProductUnitEnum,
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
 * **Filler** products are generated, and exist only so lists, pagination and the facet filters
 * have volume behind them. Nothing should ever be demonstrated on one.
 *
 * Curated first in the run, so the readable rows carry the low ids.
 */
const FILLER_TARGET = 30;

const FILLER_NAMES: readonly string[] = [
	'Meridian 32 Monitor',
	'Tessellate Desk Mat',
	'Basalt Laptop Stand',
	'Solstice Bookshelf Speaker',
	'Portico Laser Printer',
	'Vellum Document Scanner',
	'Kestrel Webcam',
	'Anvil Cable Sleeve',
	'Ferrite Charging Cable',
	'Cobalt Power Strip',
	'Marlin Docking Station',
	'Junction Ethernet Switch',
	'Pallas Studio Microphone',
	'Cirrus Air Purifier',
	'Thicket Garden Trimmer',
];

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

/** Sale price per market. Both currencies are quoted outright - no rate is applied to a price. */
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
 * `delta` adjusts the component's *own* price, so a component the bundle price already covers
 * carries its whole price back as a negative and adds nothing - which is how the two menus
 * below are priced.
 */
type CuratedBundle = {
	/** Exactly one candidate is taken from each; two is the fewest that makes it a choice. */
	groups?: readonly {
		prompt: string;
		candidates: readonly {
			sku: string;
			delta: Money;
			is_default?: boolean;
		}[];
	}[];
	/** Components the bundle simply contains, and the ones the customer may decline. */
	components?: readonly {
		sku: string;
		quantity?: number;
		is_optional?: boolean;
		is_default?: boolean;
		delta?: Money;
	}[];
};

type CuratedProduct = {
	slug: string;
	label: string;
	description: string;
	/** Romanian wording, so the language switcher has a second row to render. */
	ro: { slug: string; label: string; description: string };
	category_slug: string;
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
				EUR: TSHIRT_BASE.EUR + size.surcharge.EUR + 4,
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
				prices: { RON: 4999, EUR: 999 },
				reference: { RON: 5499, EUR: 1099 },
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
				prices: { RON: 449, EUR: 89 },
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
				prices: { RON: 179, EUR: 35 },
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
				prices: { RON: 249, EUR: 49 },
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
					{ label: 'Extra cheese', delta: { RON: 6, EUR: 1.2 } },
					{ label: 'Mushrooms', delta: { RON: 4, EUR: 0.8 } },
					{ label: 'Olives', delta: { RON: 4, EUR: 0.8 } },
				],
			},
		],
		variants: [
			{
				sku: 'PIZ-MAR-25',
				prices: { RON: 32, EUR: 6.5 },
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
				prices: { RON: 42, EUR: 8.5 },
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
					{ label: 'Extra cheese', delta: { RON: 6, EUR: 1.2 } },
					{ label: 'Pepperoni', delta: { RON: 7, EUR: 1.4 } },
					{ label: 'Olives', delta: { RON: 4, EUR: 0.8 } },
				],
			},
		],
		variants: [
			{
				sku: 'PIZ-DIA-25',
				prices: { RON: 38, EUR: 7.5 },
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
				prices: { RON: 48, EUR: 9.5 },
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
				prices: { RON: 50, EUR: 10 },
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
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'DRK-COLA-330',
				prices: { RON: 8, EUR: 1.6 },
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
		tags: ['Eco Friendly'],
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'DRK-WATER-500',
				prices: { RON: 6, EUR: 1.2 },
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
		tags: ['New Arrival'],
		workflow: ProductWorkflowEnum.READY,
		variants: [
			{
				sku: 'DRK-JUICE-250',
				prices: { RON: 10, EUR: 2 },
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
	 * The bundles. Both are priced so the arithmetic reads at a glance: a candidate the menu
	 * price already covers carries its whole price back as a delta and adds nothing, and the
	 * pricier alternative carries the *same* delta, so what it adds is exactly the upgrade.
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
		tags: ['Best Seller'],
		workflow: ProductWorkflowEnum.READY,
		bundle: {
			groups: [
				{
					prompt: 'Choose your pizza',
					candidates: [
						{
							sku: 'PIZ-MAR-32',
							delta: { RON: -42, EUR: -8.5 },
							is_default: true,
						},
						// 48 - 42 = 6 RON to move up to the Diavola
						{ sku: 'PIZ-DIA-32', delta: { RON: -42, EUR: -8.5 } },
					],
				},
				{
					prompt: 'Choose your drink',
					candidates: [
						{
							sku: 'DRK-COLA-330',
							delta: { RON: -8, EUR: -1.6 },
							is_default: true,
						},
						// 10 - 8 = 2 RON for the juice instead
						{ sku: 'DRK-JUICE-250', delta: { RON: -8, EUR: -1.6 } },
					],
				},
			],
			components: [
				{
					sku: 'SAU-GARLIC-50',
					is_optional: true,
					is_default: true,
					// 5 - 2 = 3 RON: cheaper inside the menu than bought alone
					delta: { RON: -2, EUR: -0.4 },
				},
			],
		},
		variants: [
			{
				sku: 'MENU-PIZZA-NIGHT',
				prices: { RON: 55, EUR: 11 },
				reference: { RON: 65, EUR: 13 },
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
					// 249 - 50 = 199 RON to add the hub to the kit
					delta: { RON: -50, EUR: -10 },
				},
			],
		},
		variants: [
			{
				sku: 'KIT-DESK',
				prices: { RON: 549, EUR: 109 },
				reference: { RON: 628, EUR: 124 },
			},
		],
	},
];

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

		// Product categories only: an article category linked to a product would file it under a
		// tree the storefront never shows
		const categories = await manager.getRepository(CategoryEntity).find({
			select: { id: true },
			where: { type: CategoryTypeEnum.PRODUCT },
			order: { id: 'ASC' },
		});

		const categoryIds = categories.map((category) => category.id);

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

		const labelId = (label: string): number | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.ATTRIBUTE_LABEL, label));

		const valueId = (value: string): number | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.ATTRIBUTE_VALUE, value));

		/** An order-time prompt or answer, which is free wording rather than vocabulary. */
		const textId = (value: string): number | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.TEXT, value));

		/** The question a bundle choice asks, from the terms seeded for exactly that. */
		const promptId = (prompt: string): number | undefined =>
			termIdByKey.get(termKey(TermTypeEnum.BUNDLE_CHOICE, prompt));

		/** A tag by its wording. Keyed folded, since a tag is stored lower-cased. */
		const tagId = (tag: string): number | undefined =>
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
							term_id: option.term_id as number,
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
		const variantIdBySku = new Map<string, number>();

		let alreadyPresent = 0;
		let inserted = 0;

		/** One price row per market, from the sale price and whatever else the entry quotes. */
		const savePrices = async (
			variant_id: number,
			prices: Money,
			reference?: Money,
		): Promise<void> => {
			await priceRepository.save(
				(['RON', 'EUR'] as const).map((currency) =>
					priceRepository.create({
						variant_id,
						currency,
						sale_price: prices[currency],
						reference_price: reference?.[currency] ?? null,
						// The floor a discount may not drop below - 20% off the sale price
						min_price: Number((prices[currency] * 0.8).toFixed(2)),
					}),
				),
			);
		};

		/**
		 * One attribute value, written to whichever table its scope belongs to. A numeric value
		 * also carries `value_base`, the figure converted into its dimension's base unit - the
		 * same conversion the service applies on write, and what a range filter compares.
		 */
		const saveAttribute = async (
			owner: { product_id: number } | { variant_id: number },
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
					vat_category: ProductVatCategoryEnum.STANDARD,
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
				.filter((tag_id): tag_id is number => tag_id !== undefined);

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
						cost_price: Number((spec.prices.RON * 0.6).toFixed(2)),
					}),
				);

				variantIdBySku.set(spec.sku, variant.id);

				await savePrices(variant.id, spec.prices, spec.reference);

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
								price_delta: option.delta[currency],
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
									price_delta: candidate.delta[currency],
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

					if (component.delta) {
						await bundleItemPriceRepository.save(
							(['RON', 'EUR'] as const).map((currency) =>
								bundleItemPriceRepository.create({
									item_id: item.id,
									currency,
									price_delta: (component.delta as Money)[
										currency
									],
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
		const colorValues = ['red', 'blue', 'green', 'black', 'silver'];
		const sizeValues = ['small', 'medium', 'large'];

		const warrantyPromptId = textId('Extended warranty');

		const warrantyOptions = ['One extra year', 'Two extra years'];

		for (let index = 0; index < FILLER_TARGET; index++) {
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
					vat_category: ProductVatCategoryEnum.STANDARD,
					brand_id: brandIds.length
						? randomPick(random, brandIds)
						: null,
				}),
			);

			const pass = Math.floor(index / FILLER_NAMES.length);
			const baseName = FILLER_NAMES[index % FILLER_NAMES.length];
			const label = pass ? `${baseName} (Mk ${pass + 1})` : baseName;

			await contentRepository.save(
				contentRepository.create({
					product_id: product.id,
					language: 'en',
					slug,
					label,
					description: `${label} - demo catalog entry ${sequenceLabel(index)}.`,
					meta: {
						title: label,
						description: `${label} - specifications and price`,
					},
				}),
			);

			const category_id = categoryIds.length
				? randomPick(random, categoryIds)
				: null;

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

			const variantCount = randomInt(random, 1, 3);
			const basePrice = randomInt(random, 20, 900) + 0.99;

			for (
				let variantIndex = 0;
				variantIndex < variantCount;
				variantIndex++
			) {
				const variant = await variantRepository.save(
					variantRepository.create({
						product_id: product.id,
						sku: `${variantSku}-V${variantIndex + 1}`,
						position: variantIndex,
						is_default: variantIndex === 0,
						track_stock: index % 3 === 0,
						low_stock_threshold: index % 3 === 0 ? 5 : null,
						allow_backorder: false,
						cost_price: Number((basePrice * 0.6).toFixed(2)),
					}),
				);

				// Filler is quoted in the app currency alone; the curated half is what carries
				// a second market
				await priceRepository.save(
					priceRepository.create({
						variant_id: variant.id,
						currency: 'RON',
						sale_price: Number(
							(basePrice + variantIndex * 25).toFixed(2),
						),
						reference_price: Number(
							(basePrice + variantIndex * 25 + 30).toFixed(2),
						),
						min_price: Number((basePrice * 0.8).toFixed(2)),
					}),
				);

				const sizeTermId = valueId(
					sizeValues[variantIndex] ?? 'medium',
				);

				if (variantCount > 1 && sizeTermId) {
					await variantAttributeRepository.save(
						variantAttributeRepository.create({
							variant_id: variant.id,
							attribute_label_id: labelId('size') as number,
							value_term_id: sizeTermId,
						}),
					);
				}
			}

			const colorTermId = valueId(randomPick(random, colorValues));
			const colorLabelId = labelId('color');

			if (colorTermId && colorLabelId) {
				await attributeRepository.save(
					attributeRepository.create({
						product_id: product.id,
						attribute_label_id: colorLabelId,
						value_term_id: colorTermId,
					}),
				);
			}

			// Every fifth product carries a capacity, so the numeric facet has rows to answer
			// with. `value_base` is the figure in the dimension's base unit - the same
			// conversion the service applies on write
			const capacityLabelId = labelId('capacity');

			if (capacityLabelId && index % 5 === 0) {
				const capacity = randomInt(random, 2, 20) * 100;

				await attributeRepository.save(
					attributeRepository.create({
						product_id: product.id,
						attribute_label_id: capacityLabelId,
						value_numeric: capacity,
						value_base: toBaseUnit(
							capacity,
							MeasureUnitEnum.MILLILITRE,
						),
					}),
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

			// Every fourth product asks a question at order time. `min_select` 0 and
			// `max_select` 1 is the optional single choice - there is no `is_required` flag to
			// agree with
			if (index % 4 === 0 && warrantyPromptId) {
				const group = await optionGroupRepository.save(
					optionGroupRepository.create({
						product_id: product.id,
						label_id: warrantyPromptId,
						min_select: 0,
						max_select: 1,
						position: 0,
					}),
				);

				for (const [optionIndex, value] of warrantyOptions.entries()) {
					const optionTermId = textId(value);

					if (!optionTermId) {
						continue;
					}

					const option = await optionRepository.save(
						optionRepository.create({
							option_group_id: group.id,
							label_id: optionTermId,
							position: optionIndex,
							is_default: false,
						}),
					);

					await optionPriceRepository.save(
						optionPriceRepository.create({
							option_id: option.id,
							currency: 'RON',
							price_delta: (optionIndex + 1) * 99,
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
