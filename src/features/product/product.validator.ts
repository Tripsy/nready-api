import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	ProductCompositionEnum,
	ProductSaleStatusEnum,
	ProductTypeEnum,
	ProductUnitEnum,
	ProductVatCategoryEnum,
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, normalizeCurrency } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * `workflow` and `sale_status` are deliberately absent: the first moves through its own route so
 * the transition map is consulted, and the second is derived from the availability timestamps by
 * a cron rather than stated.
 */
export const paramsUpdateList: string[] = [
	'type',
	'composition',
	'unit',
	'vat_category',
	'available_from',
	'available_until',
	'discontinued_at',
	'brand_id',
	'contents',
	'categories',
	'tags',
	'variants',
	'attributes',
	'availabilities',
	'option_groups',
	'bundle_groups',
	'bundle_items',
];

/**
 * `label` is the translation's, not a column on `product` - `ProductService` maps it onto the
 * `content` join alias before the query builder sees it. Stated bare here so a join alias never
 * becomes part of the API contract.
 */
export const OrderByEnum = {
	ID: 'id',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_sku',
	'invalid_label',
	'invalid_slug',
	'invalid_description',
	'invalid_type',
	'invalid_composition',
	'invalid_unit',
	'invalid_vat_category',
	'invalid_workflow',
	'invalid_sale_status',
	'invalid_currency',
	'invalid_price',
	'invalid_price_delta',
	'invalid_quantity',
	'min_price_above_price',
	'invalid_categories',
	'categories_required',
	'invalid_tags',
	'invalid_brand_id',
	'invalid_variants',
	'variants_required',
	'variant_default_required',
	'variant_sku_duplicate',
	'invalid_attribute',
	'attribute_value_required',
	'invalid_availability',
	'availability_end_before_start',
	'availability_hours_paired',
	'availability_day_duplicate',
	'availability_every_day_exclusive',
	'invalid_option_group',
	'invalid_option',
	'option_max_below_min',
	'option_min_above_options',
	'option_default_duplicate',
	'invalid_bundle_item',
	'bundle_group_too_few',
	'bundle_optional_in_group',
	'bundle_composition_too_small',
	'bundle_default_not_chosen',
	'bundle_delta_not_chosen',
	'available_until_before_from',
] as const;

export class ProductValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * ISO 4217, upper-cased so `ron` and `RON` reach the same `(variant_id, currency)` unique
	 * index rather than passing as two prices for one market.
	 */
	readonly currencySchema = z
		.string({ message: this.getMessage('invalid_currency') })
		.length(CURRENCY_CODE_CHARS, {
			message: this.getMessage('invalid_currency'),
		})
		.transform(normalizeCurrency);

	/**
	 * A display slot or a threshold, where zero is a legitimate value - the first position, or a
	 * variant that is low on stock as soon as it has none. `validateNumber` is positive-only by
	 * default, which rejects it.
	 */
	private readonly nonNegative = (message: string) =>
		this.validateNumber(message, {
			required: false,
			onlyPositive: false,
		}).refine(
			(value) => value === undefined || value === null || value >= 0,
			{ message },
		);

	readonly contentsSchema = z.object({
		language: this.validateLanguage(this.getMessage('invalid_language')),
		slug: this.validateString(this.getMessage('invalid_slug')).transform(
			(value) => value.trim().toLowerCase(),
		),
		label: this.validateString(this.getMessage('invalid_label')),
		description: this.validateString(
			this.getMessage('invalid_description'),
			{ required: false },
		),
		meta: this.validateMeta({
			invalid_meta_title: this.getMessage('invalid_meta_title'),
			invalid_meta_description: this.getMessage(
				'invalid_meta_description',
			),
			invalid_meta_keywords: this.getMessage('invalid_meta_keywords'),
		}),
	});

	/**
	 * Excludes VAT, like the column it feeds. `min_price` is the floor a stacked discount may
	 * not resolve below, so it is checked against `sale_price` here as well as by the table's own
	 * `@Check` - a constraint violation would reach the client as a masked 500.
	 */
	readonly priceSchema = z
		.object({
			currency: this.currencySchema,
			sale_price: this.validateNumber(this.getMessage('invalid_price'), {
				allowDecimals: 2,
			}),
			reference_price: this.validateNumber(
				this.getMessage('invalid_price'),
				{
					required: false,
					allowDecimals: 2,
				},
			),
			min_price: this.validateNumber(this.getMessage('invalid_price'), {
				required: false,
				allowDecimals: 2,
			}),
		})
		.refine(
			(data) =>
				data.min_price === undefined ||
				data.min_price === null ||
				data.min_price <= data.sale_price,
			{
				message: this.getMessage('min_price_above_price'),
				path: ['min_price'],
			},
		);

	/** Signed, unlike a price: "no side, −5.00" is an answer, not a discount. */
	readonly priceDeltaSchema = z.object({
		currency: this.currencySchema,
		price_delta: this.validateNumber(
			this.getMessage('invalid_price_delta'),
			{
				onlyPositive: false,
				allowDecimals: 2,
			},
		),
	});

	/**
	 * One value column and only one, mirroring the `@Check` both attribute tables carry.
	 *
	 * `value_base` is absent on purpose: it is `value_numeric` run through the definition's
	 * unit factor, derived by the service on every write, and a payload that could state it
	 * could state a figure the number does not agree with.
	 */
	private readonly attributeValueShape = {
		attribute_label_id: this.validateId(
			this.getMessage('invalid_id', { name: 'attribute_label_id' }),
		),
		value_term_id: this.validateId(
			this.getMessage('invalid_id', { name: 'value_term_id' }),
			{ required: false },
		),
		value_numeric: this.validateNumber(this.getMessage('invalid_number'), {
			required: false,
			onlyPositive: false,
			allowDecimals: 4,
		}),
		value_text: this.validateString(this.getMessage('invalid_string'), {
			required: false,
			maxChars: 255,
		}),
		/*
		 * `.optional()` on top of `required: false`: the two say different things.
		 * `validateBoolean`'s option decides whether `false` is accepted as a value, not
		 * whether the key may be absent - without it, a payload naming any other value column
		 * is rejected for the boolean it deliberately left out.
		 */
		value_boolean: this.validateBoolean(
			this.getMessage('invalid_boolean'),
			{
				required: false,
			},
		).optional(),
	};

	private readonly refineSingleValue = (data: {
		value_term_id?: EntityId | null;
		value_numeric?: number | null;
		value_text?: string | null;
		value_boolean?: boolean | null;
	}): boolean =>
		[
			data.value_term_id,
			data.value_numeric,
			data.value_text,
			data.value_boolean,
		].filter((value) => value !== undefined && value !== null).length === 1;

	readonly attributeSchema = z
		.object(this.attributeValueShape)
		.refine(this.refineSingleValue, {
			message: this.getMessage('attribute_value_required'),
			path: ['value_term_id'],
		});

	/**
	 * The variant's own axes. Same shape as a product attribute, but the table's unique key
	 * stops at the label, so the payload may not name one label twice - a variant cannot be
	 * both `large` and `small`.
	 */
	readonly variantAttributeSchema = z
		.object(this.attributeValueShape)
		.refine(this.refineSingleValue, {
			message: this.getMessage('attribute_value_required'),
			path: ['value_term_id'],
		});

	readonly variantSchema = z.object({
		sku: this.validateString(this.getMessage('invalid_sku'), {
			maxChars: 255,
		}).transform((value) => value.trim()),
		barcode: this.validateString(this.getMessage('invalid_string'), {
			required: false,
			maxChars: 255,
		}),
		position: this.nonNegative(this.getMessage('invalid_number')),
		is_default: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).default(false),
		track_stock: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).default(false),
		low_stock_threshold: this.nonNegative(
			this.getMessage('invalid_number'),
		),
		allow_backorder: this.validateBoolean(
			this.getMessage('invalid_boolean'),
			{ required: false },
		).default(false),
		// Base currency only - `product_price` is the per-market side. Zero is a legitimate
		// cost (a sample, a giveaway), so the bound is the table's `>= 0` rather than `> 0`
		cost_price: this.validateNumber(this.getMessage('invalid_price'), {
			required: false,
			onlyPositive: false,
			allowDecimals: 2,
		}).refine(
			(value) => value === undefined || value === null || value >= 0,
			{
				message: this.getMessage('invalid_price'),
			},
		),
		prices: z.array(this.priceSchema).default([]),
		/*
		 * Optional rather than defaulted, unlike `prices` above: `syncAttributes` reads an
		 * empty array as "clear the axis values", so a default would make every payload that
		 * omits the key destructive. Absent leaves the stored values alone and `[]` clears
		 * them - the same split as the product-level `attributes`.
		 */
		attributes: z.array(this.variantAttributeSchema).optional(),
	});

	readonly availabilitySchema = z
		.object({
			// ISO 8601 weekdays, 1 = Monday … 7 = Sunday - the numbering
			// `discount.conditions.day_range` is written in, so a stored weekday means the same
			// thing wherever it is read. NULL means every day, which is why the field is
			// optional rather than defaulted
			day_of_week: this.validateNumber(
				this.getMessage('invalid_availability'),
				{ required: false },
			).refine(
				(value) =>
					value === undefined ||
					value === null ||
					(value >= 1 && value <= 7),
				{ message: this.getMessage('invalid_availability') },
			),
			// Null in both together means all day; the pairing is enforced below, and by a
			// check constraint on the table
			starts_at: this.validateTime(
				this.getMessage('invalid_availability'),
				{ required: false },
			),
			ends_at: this.validateTime(
				this.getMessage('invalid_availability'),
				{ required: false },
			),
		})
		.refine(
			(data) => !data.starts_at === !data.ends_at,
			// Reported on `ends_at` because that is the one a half-filled row usually lacks.
			{
				message: this.getMessage('availability_hours_paired'),
				path: ['ends_at'],
			},
		)
		.refine(
			(data) =>
				!data.starts_at ||
				!data.ends_at ||
				data.ends_at > data.starts_at,
			{
				message: this.getMessage('availability_end_before_start'),
				path: ['ends_at'],
			},
		);

	/**
	 * The set of intervals, with the two rules that hold across it.
	 *
	 * One interval per day: a product is orderable on a given weekday between one pair of hours,
	 * not several. A partial unique index on `(product_id, day_of_week) NULLS NOT DISTINCT` backs
	 * the same-day half up at the database, which is what makes a concurrent write safe - but no
	 * index reaches the every-day half, because that compares rows holding *different* values.
	 *
	 * Each message lands on the offending row's own `day_of_week` rather than on the array, so it
	 * renders against the select the editor would have to change.
	 */
	readonly availabilitiesSchema = z
		.array(this.availabilitySchema)
		.superRefine((windows, ctx) => {
			const seen = new Set<number>();

			windows.forEach((window, index) => {
				if (
					window.day_of_week === null ||
					window.day_of_week === undefined
				) {
					// An every-day interval covers every weekday, so it can only stand alone.
					if (windows.length > 1) {
						ctx.addIssue({
							code: 'custom',
							path: [index, 'day_of_week'],
							message: this.getMessage(
								'availability_every_day_exclusive',
							),
						});
					}

					return;
				}

				if (seen.has(window.day_of_week)) {
					ctx.addIssue({
						code: 'custom',
						path: [index, 'day_of_week'],
						message: this.getMessage('availability_day_duplicate'),
					});

					return;
				}

				seen.add(window.day_of_week);
			});
		});

	readonly optionSchema = z.object({
		label_id: this.validateId(
			this.getMessage('invalid_id', { name: 'label_id' }),
		),
		position: this.nonNegative(this.getMessage('invalid_number')),
		is_default: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).default(false),
		prices: z.array(this.priceDeltaSchema).default([]),
	});

	/**
	 * Cardinality is the `min_select` / `max_select` pair and nothing else - there is no
	 * `is_required` flag to keep in agreement with it.
	 *
	 * Three checks, because two of them the table cannot make: `max >= min` is its `@Check`
	 * repeated so the failure arrives as a 422, and `min <= options.length` spans the group and
	 * its answers, which a row-level constraint cannot see. A group demanding two answers from
	 * a list of one can never be satisfied at checkout.
	 */
	readonly optionGroupSchema = z
		.object({
			label_id: this.validateId(
				this.getMessage('invalid_id', { name: 'label_id' }),
			),
			min_select: this.validateNumber(
				this.getMessage('invalid_option_group'),
				{ required: false, onlyPositive: false },
			).refine(
				(value) => value === undefined || value === null || value >= 0,
				{ message: this.getMessage('invalid_option_group') },
			),
			max_select: this.validateNumber(
				this.getMessage('invalid_option_group'),
				{ required: false },
			),
			position: this.nonNegative(this.getMessage('invalid_number')),
			options: z
				.array(this.optionSchema)
				.min(1, { message: this.getMessage('invalid_option') }),
		})
		.refine(
			(data) =>
				data.max_select === undefined ||
				data.max_select === null ||
				data.max_select >= (data.min_select ?? 0),
			{
				message: this.getMessage('option_max_below_min'),
				path: ['max_select'],
			},
		)
		.refine((data) => (data.min_select ?? 0) <= data.options.length, {
			message: this.getMessage('option_min_above_options'),
			path: ['min_select'],
		})
		.refine(
			(data) =>
				data.options.filter((option) => option.is_default).length <= 1,
			{
				message: this.getMessage('option_default_duplicate'),
				path: ['options'],
			},
		);

	/**
	 * A choice offered inside a bundle: a prompt, and nothing else. Exactly one of its candidates
	 * is taken, which is the whole of what a bundle choice means - there is no `min_select` /
	 * `max_select` pair to carry, unlike `optionGroupSchema`. See the entity for why a bound
	 * counting candidate rows could not state the one case that would want it.
	 *
	 * Named by its label term rather than by an id, the way `optionGroupSchema` is and for the
	 * same reason: a group has no id until it is written, and the payload has to be able to name
	 * one it is creating in the same request.
	 *
	 * Nothing is checked here. How many candidates the group has spans this array and
	 * `bundle_items` - and on an update either may be absent, so only the rows read back after the
	 * write know the answer. That rule lives in `assertBundleGroupsAreUsable`.
	 */
	readonly bundleGroupSchema = z.object({
		label_id: this.validateId(
			this.getMessage('invalid_id', { name: 'label_id' }),
		),
		position: this.nonNegative(this.getMessage('invalid_number')),
	});

	/**
	 * A component, and who gets to decide on it: nobody, the customer, or the group it is a
	 * candidate for.
	 *
	 * The three refines guard one idea from three sides. `is_default` and `prices` describe a
	 * choice, so a component that is always included - no group, not optional - may carry
	 * neither: its delta would have nothing to adjust, since the bundle's own price already
	 * covers it, and preselecting something the customer cannot untick says nothing at all.
	 * `is_optional` is the mirror image, refused inside a group: a group already says exactly one
	 * of its candidates is taken, and a row claiming to be optional on its own terms as well
	 * would be two answers to one question. Refused rather than ignored,
	 * so a payload that means one thing and stores another is caught at the edge.
	 *
	 * `quantity` is the same positive figure throughout, read as a count on a component that is
	 * always included or a candidate, and as a ceiling on an optional one - a group decides which
	 * candidate is taken, never how many of it.
	 */
	readonly bundleItemSchema = z
		.object({
			variant_id: this.validateId(
				this.getMessage('invalid_id', { name: 'variant_id' }),
			),
			quantity: this.validateNumber(this.getMessage('invalid_quantity'), {
				required: false,
				allowDecimals: 2,
			}),
			position: this.nonNegative(this.getMessage('invalid_number')),
			/*
			 * The label of a group in the same payload, not a `group_id`: the group it names may
			 * be created by this very request. Resolved to a row id by the service, which is
			 * where an unknown label is refused.
			 */
			group_label_id: this.validateId(
				this.getMessage('invalid_id', { name: 'group_label_id' }),
				{ required: false },
			),
			is_optional: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
			is_default: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
			prices: z.array(this.priceDeltaSchema).default([]),
		})
		.refine((data) => !data.is_optional || !data.group_label_id, {
			message: this.getMessage('bundle_optional_in_group'),
			path: ['is_optional'],
		})
		.refine(
			(data) =>
				data.is_optional ||
				Boolean(data.group_label_id) ||
				!data.is_default,
			{
				message: this.getMessage('bundle_default_not_chosen'),
				path: ['is_default'],
			},
		)
		.refine(
			(data) =>
				data.is_optional ||
				Boolean(data.group_label_id) ||
				data.prices.length === 0,
			{
				message: this.getMessage('bundle_delta_not_chosen'),
				path: ['prices'],
			},
		);

	/**
	 * `required` means "not empty when present" rather than "the key must exist": an update is
	 * partial and the service only touches a link table whose key is in the payload, so an
	 * absent list leaves the links alone while `[]` clears them.
	 */
	readonly idListSchema = (
		message: string,
		options: { required?: boolean; requiredMessage?: string } = {},
	) => {
		const schema = z.array(this.validateId(message), { message: message });

		if (!options.required) {
			return schema.optional();
		}

		return schema
			.min(1, { message: options.requiredMessage ?? message })
			.optional();
	};

	/**
	 * Exactly one variant carries `is_default`, and no two share a SKU.
	 *
	 * The table holds a partial unique index for the first half, which enforces *at most* one -
	 * nothing in the schema says a product must have one at all, and nothing can see the whole
	 * payload to reject two SKUs that are equal to each other but free in the table.
	 */
	private readonly refineVariants = (
		variants: z.infer<ProductValidator['variantSchema']>[],
		ctx: z.RefinementCtx,
	): void => {
		if (variants.filter((variant) => variant.is_default).length !== 1) {
			// No `path`: the refine runs on the array itself, so an added segment reads as
			// `variants.variants` rather than naming the field once
			ctx.addIssue({
				code: 'custom',
				message: this.getMessage('variant_default_required'),
			});
		}

		const skus = variants.map((variant) => variant.sku);

		if (new Set(skus).size !== skus.length) {
			ctx.addIssue({
				code: 'custom',
				message: this.getMessage('variant_sku_duplicate'),
			});
		}
	};

	/**
	 * The catalog window on the row as the payload states it. A partial update that moves one
	 * date alone is compared against the stored row in `ProductService.assertAvailabilityWindow`,
	 * which is the only place both values are known.
	 */
	private readonly refineAvailabilityWindow = (
		data: { available_from?: Date | null; available_until?: Date | null },
		ctx: z.RefinementCtx,
	): void => {
		if (!data.available_from || !data.available_until) {
			return;
		}

		if (data.available_until > data.available_from) {
			return;
		}

		ctx.addIssue({
			code: 'custom',
			path: ['available_until'],
			message: this.getMessage('available_until_before_from'),
		});
	};

	private readonly manageShape = {
		type: this.validateEnum(
			ProductTypeEnum,
			this.getMessage('invalid_type'),
			{
				required: false,
			},
		),
		composition: this.validateEnum(
			ProductCompositionEnum,
			this.getMessage('invalid_composition'),
			{ required: false },
		),
		unit: this.validateEnum(
			ProductUnitEnum,
			this.getMessage('invalid_unit'),
			{
				required: false,
			},
		),
		vat_category: this.validateEnum(
			ProductVatCategoryEnum,
			this.getMessage('invalid_vat_category'),
			{ required: false },
		),
		available_from: this.validateDate(this.getMessage('invalid_date'), {
			required: false,
		}),
		available_until: this.validateDate(this.getMessage('invalid_date'), {
			required: false,
		}),
		discontinued_at: this.validateDate(this.getMessage('invalid_date'), {
			required: false,
		}),
		brand_id: this.validateId(this.getMessage('invalid_brand_id'), {
			required: false,
		}),
		attributes: z.array(this.attributeSchema).optional(),
		availabilities: this.availabilitiesSchema.optional(),
		option_groups: z.array(this.optionGroupSchema).optional(),
		/*
		 * Two flat lists rather than candidates nested inside their group, so the shape a bundle
		 * had before groups existed still parses and a component is described in exactly one
		 * place whether it belongs to a group or not. `bundle_items[].group_label_id` is the tie,
		 * and the service resolves it against the groups live after `bundle_groups` is synced.
		 */
		bundle_groups: z.array(this.bundleGroupSchema).optional(),
		bundle_items: z.array(this.bundleItemSchema).optional(),
		tags: this.idListSchema(this.getMessage('invalid_tags')),
	};

	readonly create = z
		.object({
			...this.manageShape,
			contents: this.contentsSchema
				.array()
				.min(1, this.getMessage('invalid_contents'))
				.refine(
					(contents) => {
						const languages = contents.map(
							(content) => content.language,
						);

						return new Set(languages).size === languages.length;
					},
					{ message: this.getMessage('duplicate_contents') },
				),
			/*
			 * A product's attribute form is resolved from its categories, so one filed under
			 * nothing has no form to fill in. The public address does not depend on them -
			 * it is `/products/<product-slug>`, the slug alone.
			 */
			categories: this.idListSchema(
				this.getMessage('invalid_categories'),
				{
					required: true,
					requiredMessage: this.getMessage('categories_required'),
				},
			).nonoptional({
				message: this.getMessage('categories_required'),
			}),
			/*
			 * Required here and optional on update: every product carries at least one
			 * variant, because that is where price and stock hang. A product with nothing to
			 * vary sends one variant, which is the normal case rather than a special one.
			 */
			variants: z
				.array(this.variantSchema)
				.min(1, { message: this.getMessage('variants_required') })
				.superRefine(this.refineVariants),
		})
		.superRefine(this.refineAvailabilityWindow);

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		language: this.validateLanguage(this.getMessage('invalid_language'), {
			required: false,
		}),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			...this.manageShape,
			contents: this.contentsSchema
				.array()
				.refine(
					(contents) => {
						const languages = contents.map(
							(content) => content.language,
						);

						return new Set(languages).size === languages.length;
					},
					{ message: this.getMessage('duplicate_contents') },
				)
				.optional(),
			categories: this.idListSchema(
				this.getMessage('invalid_categories'),
				{
					required: true,
					requiredMessage: this.getMessage('categories_required'),
				},
			),
			// Optional, but never empty: the variant set may be replaced, not removed
			variants: z
				.array(this.variantSchema)
				.min(1, { message: this.getMessage('variants_required') })
				.superRefine(this.refineVariants)
				.optional(),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		})
		.superRefine(this.refineAvailabilityWindow);

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly workflowUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		workflow: this.validateEnum(
			ProductWorkflowEnum,
			this.getMessage('invalid_workflow'),
		),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			/*
			 * A list rather than a scalar, so a caller holding several ids - the discount view
			 * naming its targets - resolves them all in one request. A single id still arrives
			 * as one.
			 */
			id: this.validateIdFilter(
				this.getMessage('invalid_ids', { name: 'id' }),
				{
					required: false,
				},
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			workflow: this.validateEnum(
				ProductWorkflowEnum,
				this.getMessage('invalid_workflow'),
				{ required: false },
			),
			type: this.validateEnum(
				ProductTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			composition: this.validateEnum(
				ProductCompositionEnum,
				this.getMessage('invalid_composition'),
				{ required: false },
			),
			/*
			 * Where the product sits in its selling window. Narrower than `is_sellable`, which
			 * folds this together with `workflow` and the timestamps - this one answers the
			 * status column on its own, which is what the listing's badge shows.
			 */
			sale_status: this.validateEnum(
				ProductSaleStatusEnum,
				this.getMessage('invalid_sale_status'),
				{ required: false },
			),
			brand_id: this.validateId(
				this.getMessage('invalid_id', { name: 'brand_id' }),
				{
					required: false,
				},
			),
			category_id: this.validateId(
				this.getMessage('invalid_id', { name: 'category_id' }),
				{ required: false },
			),
			tag_id: this.validateId(
				this.getMessage('invalid_id', { name: 'tag_id' }),
				{
					required: false,
				},
			),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			// The sellable window - see `ProductQuery.filterBySellable`
			is_sellable: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});

	readonly publicStock = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly publicRead = z.object({
		slug: this.validateString(this.getMessage('invalid_slug')).transform(
			(value) => value.trim().toLowerCase(),
		),
		language: this.validateLanguage(this.getMessage('invalid_language'), {
			required: false,
		}),
	});

	/**
	 * One facet of a catalog filter: a label, and either a set of admissible terms or a range.
	 *
	 * Ranges are stated in the *definition's* unit and converted before they meet the column -
	 * `value_base` holds the figure in the dimension's base unit, so a range in litres and a
	 * catalog quoted in millilitres agree. `ProductService` does that conversion; the schema
	 * only takes the numbers as the form shows them.
	 */
	readonly facetSchema = z
		.object({
			label_id: this.validateId(
				this.getMessage('invalid_id', { name: 'label_id' }),
			),
			value_term_id: z
				.preprocess(
					(value) =>
						value === undefined || Array.isArray(value)
							? value
							: [value],
					z
						.array(
							this.validateId(
								this.getMessage('invalid_id', {
									name: 'value_term_id',
								}),
							),
						)
						.nonempty(),
				)
				.optional(),
			min: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
				onlyPositive: false,
				allowDecimals: 4,
			}),
			max: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
				onlyPositive: false,
				allowDecimals: 4,
			}),
		})
		.refine(
			(data) =>
				data.value_term_id !== undefined ||
				data.min !== undefined ||
				data.max !== undefined,
			{ message: this.getMessage('invalid_filter') },
		);

	readonly publicFind = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.CREATED_AT,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		// Narrower than `find` on purpose: no workflow, no brand, no is_deleted. A visitor can
		// only ever address the sellable window, so a filter that could widen it must not exist
		// on this schema at all
		filterSchema: {
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' }), {
				required: false,
			}),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			category_id: this.validateId(
				this.getMessage('invalid_id', { name: 'category_id' }),
				{ required: false },
			),
			brand_id: this.validateId(
				this.getMessage('invalid_id', { name: 'brand_id' }),
				{
					required: false,
				},
			),
			/*
			 * A list rather than a scalar: the "related products" box on a product page is
			 * matched against every tag the product it sits on carries. `qs` hands over a bare
			 * value for one `filter[tag_id][]` and an array for several, so a single id is
			 * wrapped rather than rejected.
			 */
			tag_id: z
				.preprocess(
					(value) =>
						value === undefined || Array.isArray(value)
							? value
							: [value],
					z
						.array(
							this.validateId(
								this.getMessage('invalid_id', {
									name: 'tag_id',
								}),
							),
						)
						.nonempty(),
				)
				.optional(),
			// The product the listing must not contain - the box is rendered on its own page
			exclude_id: this.validateId(
				this.getMessage('invalid_id', { name: 'exclude_id' }),
				{
					required: false,
				},
			),
			attribute: z
				.preprocess(
					(value) =>
						value === undefined || Array.isArray(value)
							? value
							: [value],
					z.array(this.facetSchema).nonempty(),
				)
				.optional(),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
		},
	});
}

export type ProductContentType = z.infer<ProductValidator['contentsSchema']>;
export type ProductPriceType = z.infer<ProductValidator['priceSchema']>;
export type ProductPriceDeltaType = z.infer<
	ProductValidator['priceDeltaSchema']
>;
export type ProductVariantType = z.infer<ProductValidator['variantSchema']>;
export type ProductAttributeType = z.infer<ProductValidator['attributeSchema']>;
export type ProductAvailabilityType = z.infer<
	ProductValidator['availabilitySchema']
>;
export type ProductOptionGroupType = z.infer<
	ProductValidator['optionGroupSchema']
>;
export type ProductBundleGroupType = z.infer<
	ProductValidator['bundleGroupSchema']
>;

export type ProductBundleItemType = z.infer<
	ProductValidator['bundleItemSchema']
>;
export type ProductFacetType = z.infer<ProductValidator['facetSchema']>;
