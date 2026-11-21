import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import {
	CategoryStatusEnum,
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const paramsUpdateList: string[] = ['parent_id', 'contents'];

export const OrderByEnum = {
	ID: 'id',
	LABEL: 'label',
	SORT_ORDER: 'sort_order',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_label',
	'invalid_slug',
	'invalid_description',
	'invalid_type',
	'invalid_parent_id',
] as const;

export class CategoryValidator extends BaseValidator<typeof validatorMessages> {
	private contentsSchema() {
		return z.object({
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
			),
			label: this.validateString(this.getMessage('invalid_label')),
			slug: this.validateString(
				this.getMessage('invalid_slug'),
			).transform((val) => val.trim().toLowerCase()),
			meta: this.validateMeta(),
			description: this.validateString(
				this.getMessage('invalid_description'),
			),
		});
	}

	readonly create = z.object({
		type: this.validateEnum(
			CategoryTypeEnum,
			this.getMessage('invalid_type'),
		),
		parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
			required: false,
		}),
		contents: this.contentsSchema().array(),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		with_ancestors: this.validateBoolean(
			this.getMessage('invalid_boolean'),
			{ required: false },
		).default(false),
		with_children: this.validateBoolean(
			this.getMessage('invalid_boolean'),
			{ required: false },
		).default(false),
		language: this.validateLanguage(this.getMessage('invalid_language'), {
			required: false,
		}),
	});

	readonly update = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
				required: false,
			}),
			contents: this.contentsSchema().array().optional(),
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

	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.ASC,

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
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			type: this.validateEnum(
				CategoryTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			).default(CategoryTypeEnum.ARTICLE),
			status: this.validateEnum(
				CategoryStatusEnum,
				this.getMessage('invalid_status'),
				{ required: false },
			),
			term: this.validateString(this.getMessage('invalid_string'), {
				required: false,
				minChars: Configuration.get('filter.termMinLength'),
			}),
			/*
			 * `parent_id` and `is_root` together address one sibling group - the same set
			 * `orderUpdate` reorders, which is why a manual-order listing needs them.
			 * They are separate params because a null parent cannot survive a query
			 * string: `preprocessOptional` folds an empty value onto `undefined`, so
			 * "the roots" is indistinguishable from "any parent" without its own flag.
			 * `is_root` wins when both are sent.
			 */
			parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
				required: false,
			}),
			is_root: this.validateBoolean(this.getMessage('invalid_boolean'), {
				required: false,
			}).default(false),
			/*
			 * Only categories with room for a child under their type's depth limit - what a
			 * parent picker has to offer, so the choice it presents and the rule the service
			 * enforces on save cannot drift apart.
			 */
			can_parent: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
			is_deleted: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			).default(false),
		},
	});

	/**
	 * The anonymous listing. Deliberately narrower than `find`: no `status` and no
	 * `is_deleted`, because a visitor may only ever address the published tree and the
	 * service pins both. What remains is how to slice that tree - by type, by sibling group,
	 * or by search term.
	 */
	readonly publicFind = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.SORT_ORDER,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			type: this.validateEnum(
				CategoryTypeEnum,
				this.getMessage('invalid_type'),
				{ required: false },
			).default(CategoryTypeEnum.PRODUCT),
			// No `term`: `filterByTerm` searches the parent's label too, through a
			// `parentContent` alias this projection has no reason to join.
			// Same pair as `find`, for the same reason: an empty `parent_id` cannot express
			// "the roots" in a query string, so the flag carries it.
			parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
				required: false,
			}),
			is_root: this.validateBoolean(this.getMessage('invalid_boolean'), {
				required: false,
			}).default(false),
		},
	});

	/**
	 * `parent_id` scopes the reorder to one sibling group; omitting it targets the roots of
	 * that type. Positions are the group's ids in the desired order.
	 */
	readonly orderUpdate = z.object({
		type: this.validateEnum(
			CategoryTypeEnum,
			this.getMessage('invalid_type'),
		),
		parent_id: this.validateId(this.getMessage('invalid_parent_id'), {
			required: false,
		}),
		positions: z
			.array(this.validateId(this.getMessage('invalid_number')))
			.min(2, {
				message: this.getMessage('array_min', {
					length: '2',
				}),
			}),
	});

	readonly statusUpdate = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
		status: this.validateEnum(
			CategoryStatusEnum,
			this.getMessage('invalid_status'),
		),
		// Used to force the `inactive` status update even if the category has active descendants
		force: this.validateBoolean(this.getMessage('invalid_boolean'), {
			required: false,
		}).default(false),
	});
}
