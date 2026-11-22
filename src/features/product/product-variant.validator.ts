import { Configuration } from '@/config/settings.config';
import {
	ProductCompositionEnum,
	ProductTypeEnum,
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

/**
 * `label` and `brand` name joined columns rather than columns on `product_variant`;
 * `ProductVariantService.resolveOrderBy` maps them, so a join alias never becomes part of the
 * API contract. Anything added here needs a matching arm there, or the sort reaches Postgres as
 * a column the root table does not have.
 */
export const OrderByEnum = {
	ID: 'id',
	SKU: 'sku',
	LABEL: 'label',
	BRAND: 'brand',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
} as const;

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_type',
	'invalid_composition',
	'invalid_workflow',
] as const;

/**
 * The variant listing's own schema. It carries `find` and nothing else: a variant is created and
 * edited through its product's form, which is where the set is synced as a whole, so this module
 * has no write surface to validate.
 */
export class ProductVariantValidator extends BaseValidator<
	typeof validatorMessages
> {
	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.ID,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		/*
		 * The product listing's filters, read across the join, plus `product_id` - which is how
		 * a picker asks for one product's variants rather than the whole catalog.
		 */
		filterSchema: {
			/*
			 * A list rather than a scalar: the bundle form holds its components as variant ids
			 * and has to resolve every one of their names in a single request, as does the
			 * discount view for its variant targets.
			 */
			id: this.validateIdFilter(
				this.getMessage('invalid_ids', { name: 'id' }),
				{
					required: false,
				},
			),
			product_id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
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
			brand_id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			category_id: this.validateNumber(
				this.getMessage('invalid_number'),
				{ required: false },
			),
			tag_id: this.validateNumber(this.getMessage('invalid_number'), {
				required: false,
			}),
			language: this.validateLanguage(
				this.getMessage('invalid_language'),
				{ required: false },
			),
			// The sellable window of the parent product - see `ProductVariantQuery`
			is_sellable: this.validateBoolean(
				this.getMessage('invalid_boolean'),
				{ required: false },
			),
			// Stock-tracked variants only - what a goods receipt may name
			track_stock: this.validateBoolean(
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
