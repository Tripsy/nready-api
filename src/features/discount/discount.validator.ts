import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	type DiscountConditions,
	DiscountReasonEnum,
	DiscountScopeEnum,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = [
	'label',
	'scope',
	'reason',
	'reference',
	'type',
	'conditions',
	'value',
	'start_at',
	'end_at',
	'notes',
];

export const OrderByEnum = {
	ID: 'id',
	LABEL: 'label',
	START_AT: 'start_at',
	END_AT: 'end_at',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_label',
	'invalid_scope',
	'invalid_reason',
	'invalid_reference',
	'invalid_type',
	'invalid_value',
	'invalid_start_at',
	'invalid_end_at',
	'start_at_in_the_past',
	'end_at_in_the_past',
	'end_at_must_be_after_start_at',
	'percent_must_be_between_0_and_100',
] as const;

export class DiscountValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * One schema per condition, rather than a `z.record` over open string keys.
	 *
	 * The keys are a closed set, so an unrecognized one is a mistake worth reporting at the
	 * boundary: the evaluator fails closed, and a discount carrying a typo'd condition would
	 * otherwise be stored happily and then never apply, with nothing to point at. `.strict()`
	 * turns that into a 422 at the moment it is written.
	 */
	conditionsSchema: z.ZodType<DiscountConditions> = z
		.object({
			hour_range: z
				.tuple([
					z.number().int().min(0).max(23),
					z.number().int().min(0).max(23),
				])
				.optional(),
			day_range: z
				.tuple([
					z.number().int().min(1).max(7),
					z.number().int().min(1).max(7),
				])
				.optional(),
			min_order_value: z.number().nonnegative().optional(),
			// ISO 3166-1 alpha-2, the vocabulary every country rule in this codebase speaks.
			// `getRequestCountry` reads it from CDN geo headers, which emit nothing else, so the
			// one input we do not control sets the standard and the rest meets it
			applicable_countries: z
				.array(z.string().length(2).toUpperCase())
				.optional(),
		})
		.strict();

	readonly create = z
		.object({
			label: this.validateString(this.getMessage('invalid_label')),
			scope: this.validateEnum(
				DiscountScopeEnum,
				this.getMessage('invalid_scope'),
			),
			reason: this.validateEnum(
				DiscountReasonEnum,
				this.getMessage('invalid_reason'),
			),
			reference: this.validateString(
				this.getMessage('invalid_reference'),
			),
			type: this.validateEnum(
				DiscountTypeEnum,
				this.getMessage('invalid_type'),
			),
			conditions: this.conditionsSchema.optional(),
			value: this.validateNumber(this.getMessage('invalid_number'), {
				required: true,
				onlyPositive: true,
				allowDecimals: 2,
			}),
			/*
			 * A new discount cannot be dated into the past. Messages are passed per key, not
			 * as one string: `buildMessage` maps a bare string onto `invalid`, which
			 * `validateDate` never reads, so the locale text would be silently dropped in
			 * favor of the built-in English defaults.
			 */
			start_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_start_at'),
					invalid_date_format: this.getMessage('invalid_start_at'),
					invalid_past_date: this.getMessage('start_at_in_the_past'),
				},
				{ required: false, maxPastSeconds: 0 },
			),
			end_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_end_at'),
					invalid_date_format: this.getMessage('invalid_end_at'),
					invalid_past_date: this.getMessage('end_at_in_the_past'),
				},
				{ required: false, maxPastSeconds: 0 },
			),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
		})
		.superRefine((data, ctx) => {
			if (data.end_at && data.start_at && data.end_at <= data.start_at) {
				ctx.addIssue({
					path: ['end_at'],
					message: this.getMessage('end_at_must_be_after_start_at'),
					code: 'custom',
				});
			}

			// Validate that percent discounts are between 0 and 100
			if (
				data.type === DiscountTypeEnum.PERCENT &&
				data.value !== undefined &&
				(data.value < 0 || data.value > 100)
			) {
				ctx.addIssue({
					path: ['value'],
					message: this.getMessage(
						'percent_must_be_between_0_and_100',
					),
					code: 'custom',
				});
			}
		});

	/** A list of owner ids for one target scope; duplicates are the caller's problem, not an error. */
	private validateIdList() {
		return z.array(
			this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		);
	}

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			label: this.validateString(this.getMessage('invalid_label'), {
				required: false,
			}),
			scope: this.validateEnum(
				DiscountScopeEnum,
				this.getMessage('invalid_scope'),
				{ required: false },
			),
			reason: this.validateEnum(
				DiscountReasonEnum,
				this.getMessage('invalid_reason'),
				{ required: false },
			),
			reference: this.validateString(
				this.getMessage('invalid_reference'),
				{ required: false },
			),
			type: this.validateEnum(
				DiscountTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			conditions: this.conditionsSchema.optional(),
			value: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
				onlyPositive: true,
				allowDecimals: 2,
			}),
			/*
			 * No `maxPastSeconds` here, unlike `create`. An update carries the whole entity,
			 * so once a discount has started, re-sending its own stored `start_at` would fail
			 * the past-date bound and the record would become permanently uneditable - the
			 * label, value or notes could never be corrected again.
			 */
			start_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_start_at'),
					invalid_date_format: this.getMessage('invalid_start_at'),
				},
				{ required: false },
			),
			end_at: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_end_at'),
					invalid_date_format: this.getMessage('invalid_end_at'),
				},
				{ required: false },
			),
			notes: this.validateString(this.getMessage('invalid_notes'), {
				required: false,
			}),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsUpdateList.join(', '),
			}),
			path: ['_global'],
		})
		.superRefine((data, ctx) => {
			if (data.end_at && data.start_at && data.end_at <= data.start_at) {
				ctx.addIssue({
					path: ['end_at'],
					message: this.getMessage('end_at_must_be_after_start_at'),
					code: 'custom',
				});
			}

			// Validate percent discount if type and value are provided
			if (
				data.type === DiscountTypeEnum.PERCENT &&
				data.value !== undefined &&
				(data.value < 0 || data.value > 100)
			) {
				ctx.addIssue({
					path: ['value'],
					message: this.getMessage(
						'percent_must_be_between_0_and_100',
					),
					code: 'custom',
				});
			}
		});

	/**
	 * Reconcile payload for `PUT /discounts/:id/targets`. Every scope is optional and a scope
	 * that is absent is left untouched, so a caller editing one scope cannot clear the others
	 * by omission - an empty array is the way to say "no targets here".
	 */
	readonly targets = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		client: this.validateIdList().optional(),
		variant: this.validateIdList().optional(),
		product: this.validateIdList().optional(),
		category: this.validateIdList().optional(),
		brand: this.validateIdList().optional(),
	});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly restore = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			scope: this.validateEnum(
				DiscountScopeEnum,
				this.getMessage('invalid_scope'),
				{ required: false },
			),
			reason: this.validateEnum(
				DiscountReasonEnum,
				this.getMessage('invalid_reason'),
				{ required: false },
			),
			type: this.validateEnum(
				DiscountTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			),
			start_at_start: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			start_at_end: this.validateDate(
				{
					invalid_date: this.getMessage('invalid_date'),
					invalid_date_format: this.getMessage('invalid_date_format'),
					invalid_past_date: this.getMessage('invalid_past_date'),
					invalid_future_date: this.getMessage('invalid_future_date'),
				},
				{ required: false },
			),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	}).superRefine((data, ctx) => {
		if (
			data.filter?.start_at_start &&
			data.filter?.start_at_end &&
			data.filter.start_at_start > data.filter.start_at_end
		) {
			ctx.addIssue({
				path: ['filter', 'start_at_start'],
				message: this.getMessage('invalid_date_range'),
				code: 'custom',
			});
		}
	});
}
