import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import { MeasureUnitEnum } from '@/shared/types/measure-unit.type';

export const paramsUpdateList: string[] = [
	'scope',
	'value_type',
	'type',
	'unit',
	'prefix',
	'suffix',
	'min_value',
	'max_value',
	'is_required',
	'is_filterable',
	'inherit',
	'sort_order',
	'options',
];

export const OrderByEnum = {
	ID: 'id',
	SORT_ORDER: 'sort_order',
	CREATED_AT: 'created_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_scope',
	'invalid_value_type',
	'invalid_capture_type',
	'invalid_measure_unit',
	'invalid_affix',
	'invalid_bound',
	'type_value_type_mismatch',
	'unit_requires_number',
	'unit_excludes_suffix',
	'bounds_require_number',
	'max_below_min',
	'options_require_term',
	'options_required',
	'invalid_ids_provided',
] as const;

/**
 * Which storage each capture may use, mirroring the `@Check` on the entity.
 *
 * Repeated here because a constraint violation reaches the client as a masked 500, and the
 * pairing is the first thing a form gets wrong. `checkbox` is the only capture admitting two:
 * it reads either as a lone yes/no toggle or as a multi-pick over the option rows.
 */
const VALUE_TYPES_BY_TYPE: Record<string, readonly string[]> = {
	[ProductCategoryAttributeTypeEnum.INPUT]: [
		ProductCategoryAttributeValueTypeEnum.NUMBER,
		ProductCategoryAttributeValueTypeEnum.STRING,
		ProductCategoryAttributeValueTypeEnum.BOOLEAN,
	],
	[ProductCategoryAttributeTypeEnum.SELECT]: [
		ProductCategoryAttributeValueTypeEnum.TERM,
	],
	[ProductCategoryAttributeTypeEnum.RADIO]: [
		ProductCategoryAttributeValueTypeEnum.TERM,
	],
	[ProductCategoryAttributeTypeEnum.CHECKBOX]: [
		ProductCategoryAttributeValueTypeEnum.TERM,
		ProductCategoryAttributeValueTypeEnum.BOOLEAN,
	],
};

export class ProductCategoryAttributeValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly optionSchema = z.object({
		term_id: this.validateId(
			this.getMessage('invalid_id', { name: 'term_id' }),
		),
		sort_order: this.validateNumber(this.getMessage('invalid_number'), {
			required: false,
			onlyPositive: false,
		}),
	});

	private readonly manageShape = {
		scope: this.validateEnum(
			ProductCategoryAttributeScopeEnum,
			this.getMessage('invalid_scope'),
			{ required: false },
		),
		value_type: this.validateEnum(
			ProductCategoryAttributeValueTypeEnum,
			this.getMessage('invalid_value_type'),
			{ required: false },
		),
		type: this.validateEnum(
			ProductCategoryAttributeTypeEnum,
			this.getMessage('invalid_capture_type'),
			{ required: false },
		),
		unit: this.validateEnum(
			MeasureUnitEnum,
			this.getMessage('invalid_measure_unit'),
			{
				required: false,
			},
		),
		prefix: this.validateString(this.getMessage('invalid_affix'), {
			required: false,
			maxChars: 16,
		}),
		suffix: this.validateString(this.getMessage('invalid_affix'), {
			required: false,
			maxChars: 16,
		}),
		min_value: this.validateNumber(this.getMessage('invalid_bound'), {
			required: false,
			onlyPositive: false,
			allowDecimals: 4,
		}),
		max_value: this.validateNumber(this.getMessage('invalid_bound'), {
			required: false,
			onlyPositive: false,
			allowDecimals: 4,
		}),
		/*
		 * `.optional()` rather than a default: `validateBoolean`'s `required` decides whether
		 * `false` is an accepted value, not whether the key may be absent. A default would also
		 * defeat the partial-update check, which counts the keys a payload actually carries.
		 */
		is_required: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).optional(),
		is_filterable: this.validateBoolean(
			this.getMessage('invalid_boolean'),
			{
				required: false,
			},
		).optional(),
		inherit: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).optional(),
		sort_order: this.validateNumber(this.getMessage('invalid_number'), {
			required: false,
			onlyPositive: false,
		}),
		options: z.array(this.optionSchema).optional(),
	};

	/**
	 * Everything the table's three `@Check` constraints say, plus the one they cannot: a
	 * list-backed definition has to carry admissible values, which live in another table.
	 *
	 * `create` states every field so the effective value is known; `update` is partial, so it
	 * runs the same rules against the merged row in
	 * `ProductCategoryAttributeService.assertDefinition` instead.
	 */
	private readonly refineDefinition = (
		data: {
			type?: string | null;
			value_type?: string | null;
			unit?: string | null;
			suffix?: string | null;
			min_value?: number | null;
			max_value?: number | null;
			options?: { term_id: EntityId }[];
		},
		ctx: z.RefinementCtx,
	): void => {
		const type = data.type ?? ProductCategoryAttributeTypeEnum.SELECT;
		const valueType =
			data.value_type ?? ProductCategoryAttributeValueTypeEnum.TERM;
		const isNumber =
			valueType === ProductCategoryAttributeValueTypeEnum.NUMBER;
		const isTerm = valueType === ProductCategoryAttributeValueTypeEnum.TERM;

		if (!VALUE_TYPES_BY_TYPE[type]?.includes(valueType)) {
			ctx.addIssue({
				code: 'custom',
				path: ['value_type'],
				message: this.getMessage('type_value_type_mismatch'),
			});
		}

		if (data.unit && !isNumber) {
			ctx.addIssue({
				code: 'custom',
				path: ['unit'],
				message: this.getMessage('unit_requires_number'),
			});
		}

		if (data.unit && data.suffix) {
			ctx.addIssue({
				code: 'custom',
				path: ['suffix'],
				message: this.getMessage('unit_excludes_suffix'),
			});
		}

		if (
			(data.min_value !== undefined && data.min_value !== null) ||
			(data.max_value !== undefined && data.max_value !== null)
		) {
			if (!isNumber) {
				ctx.addIssue({
					code: 'custom',
					path: ['min_value'],
					message: this.getMessage('bounds_require_number'),
				});
			}

			if (
				data.min_value !== undefined &&
				data.min_value !== null &&
				data.max_value !== undefined &&
				data.max_value !== null &&
				data.min_value > data.max_value
			) {
				ctx.addIssue({
					code: 'custom',
					path: ['max_value'],
					message: this.getMessage('max_below_min'),
				});
			}
		}

		if (data.options === undefined) {
			return;
		}

		/*
		 * A numeric attribute is bounded by a range, not by a list: a dropdown of allowed
		 * numbers would put the value back in a term and forfeit range filtering entirely.
		 */
		if (!isTerm && data.options.length > 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['options'],
				message: this.getMessage('options_require_term'),
			});
		}

		if (isTerm && data.options.length === 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['options'],
				message: this.getMessage('options_required'),
			});
		}
	};

	readonly create = z
		.object({
			category_id: this.validateId(
				this.getMessage('invalid_id', { name: 'category_id' }),
			),
			attribute_label_id: this.validateId(
				this.getMessage('invalid_id', { name: 'attribute_label_id' }),
			),
			...this.manageShape,
		})
		.superRefine(this.refineDefinition);

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			...this.manageShape,
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	/**
	 * The form a product in these categories renders from - a union across the categories and
	 * their ancestors, so it takes a list rather than one id.
	 */
	readonly resolve = z.object({
		category_id: z.preprocess(
			(value) =>
				value === undefined || Array.isArray(value) ? value : [value],
			z
				.array(
					this.validateId(
						this.getMessage('invalid_id', { name: 'category_id' }),
					),
				)
				.nonempty({
					message: this.getMessage('invalid_ids', {
						name: 'category_id',
					}),
				}),
		),
	});

	/**
	 * A reorder of one category's definitions. `positions` is that category's ids in the order
	 * they should be offered - the whole set, not a slice: a position only means anything
	 * relative to its siblings, so a partial list cannot describe one.
	 */
	readonly orderUpdate = z.object({
		category_id: this.validateId(
			this.getMessage('invalid_id', { name: 'category_id' }),
		),
		positions: z
			.array(this.validateId(this.getMessage('invalid_number')))
			.min(2, {
				message: this.getMessage('array_min', { length: '2' }),
			}),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.SORT_ORDER,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			category_id: this.validateId(
				this.getMessage('invalid_id', { name: 'category_id' }),
				{ required: false },
			),
			attribute_label_id: this.validateId(
				this.getMessage('invalid_id', { name: 'attribute_label_id' }),
				{ required: false },
			),
			scope: this.validateEnum(
				ProductCategoryAttributeScopeEnum,
				this.getMessage('invalid_scope'),
				{ required: false },
			),
			value_type: this.validateEnum(
				ProductCategoryAttributeValueTypeEnum,
				this.getMessage('invalid_value_type'),
				{ required: false },
			),
			is_filterable: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			),
			is_required: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});
}

export type ProductCategoryAttributeOptionType = z.infer<
	ProductCategoryAttributeValidator['optionSchema']
>;
