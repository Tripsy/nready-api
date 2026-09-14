import { z } from 'zod';
import { Configuration } from '@/config/settings.config';
import { hasAtLeastOneValue } from '@/helpers/objects.helper';
import { CURRENCY_CODE_CHARS, normalizeCurrency } from '@/helpers/shop.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import {
	BaseValidator,
	sharedValidatorMessages,
} from '@/shared/abstracts/validator.abstract';

export const OrderByEnum = {
	ID: 'id',
	CREATED_AT: 'created_at',
	UPDATED_AT: 'updated_at',
	EXPIRES_AT: 'expires_at',
} as const;

/**
 * A single line's ceiling. Not a stock check - that belongs to the catalog and is answered at
 * checkout - but a bound on what one request may set, so a typo cannot ask for ten thousand of
 * something and drag the pricing pass along with it.
 */
export const CART_QUANTITY_MAX = 999;
export const CART_OPTIONS_MAX = 20;
export const CART_NOTES_MAX = 500;

/** The most components one bundle line may cite. A bound on the payload, not a catalog rule. */
export const CART_COMPONENTS_MAX = 50;

/** What may be changed on an existing line. Options are absent - see `CartService.updateItem`. */
export const paramsItemUpdateList: string[] = ['quantity', 'notes'];

const validatorMessages = [
	...sharedValidatorMessages,
	'invalid_variant_id',
	'invalid_product_id',
	'invalid_quantity',
	'invalid_options',
	'invalid_currency',
	'invalid_client_id',
	'invalid_token',
	'invalid_components',
	'invalid_component_units',
] as const;

export class CartValidator extends BaseValidator<typeof validatorMessages> {
	/**
	 * A quantity may be fractional - `product.unit` allows `kg` and `litre`, and 0.75 kg is a
	 * legitimate line - so this is not an integer check. The column is `numeric(12,2)`, and two
	 * decimals is what it will keep.
	 */
	private quantitySchema(): z.ZodType<number> {
		const message = this.getMessage('invalid_quantity');

		return this.validateNumber(
			{
				invalid: message,
				only_positive: message,
				no_decimals: message,
			},
			{ required: true, onlyPositive: true, allowDecimals: 2 },
		).refine((value) => value <= CART_QUANTITY_MAX, { message: message });
	}

	/**
	 * The chosen `product_option` ids. Order and duplicates are not policed here - `CartService`
	 * normalizes both before the row is written, and a client that sends the same id twice meant
	 * the option once.
	 */
	private optionsSchema() {
		return z
			.array(
				this.validateId(this.getMessage('invalid_options'), {
					required: true,
				}),
			)
			.max(CART_OPTIONS_MAX, {
				message: this.getMessage('invalid_options'),
			})
			.optional();
	}

	private notesSchema() {
		return this.validateString(this.getMessage('invalid_notes'), {
			required: false,
			maxChars: CART_NOTES_MAX,
		}).optional();
	}

	/**
	 * A three-letter ISO code. Whether the catalog is actually priced in it is not a shape
	 * question - a currency with no `product_price` row resolves as a `no_price` issue on the
	 * lines, which tells the shopper far more than a 422 on the code would.
	 *
	 * Normalized here rather than in the controller, so the cart is written the one way the
	 * `product_price` lookup matches - the `required` overloads exist because that lookup takes
	 * a `string`, and a schema typed `string | undefined` pushes the coercion back out.
	 */
	private currencySchema(required: true): z.ZodType<string>;
	private currencySchema(required: false): z.ZodType<string | undefined>;

	private currencySchema(
		required: boolean,
	): z.ZodType<string> | z.ZodType<string | undefined> {
		const message = this.getMessage('invalid_currency');
		const length = {
			minChars: CURRENCY_CODE_CHARS,
			maxChars: CURRENCY_CODE_CHARS,
		};

		if (required) {
			return this.validateString(message, {
				required: true,
				...length,
			}).transform(normalizeCurrency);
		}

		return this.validateString(message, { required: false, ...length })
			.transform((value) =>
				value === undefined ? value : normalizeCurrency(value),
			)
			.optional();
	}

	/**
	 * What the shopper chose inside a bundle: the `product_bundle_item` rows they ticked or picked,
	 * and for a tick box how many units of it.
	 *
	 * **Only the decisions.** Components that always come with the kit are not listed - they are
	 * catalog data, resolved when the line is written, and naming one is refused by
	 * `ProductBundleSelectionService`. `units` is absent on a group candidate, whose own `quantity`
	 * says what the bundle contains once it is the one chosen.
	 *
	 * Whether the set answers the bundle - every group answered exactly once, every tick box
	 * within its ceiling - is not a shape question and is settled by that service.
	 */
	private componentsSchema() {
		const message = this.getMessage('invalid_components');

		return z
			.array(
				z.object({
					item_id: this.validateId(message),
					units: this.validateNumber(
						{
							invalid: this.getMessage('invalid_component_units'),
							only_positive: this.getMessage(
								'invalid_component_units',
							),
							no_decimals: this.getMessage(
								'invalid_component_units',
							),
						},
						{
							required: false,
							onlyPositive: true,
							allowDecimals: 2,
						},
					).optional(),
				}),
			)
			.max(CART_COMPONENTS_MAX, { message: message })
			.optional();
	}

	/**
	 * `product_id` travels with `variant_id` because the row holds both, under a composite foreign
	 * key. Sending a mismatched pair is rejected by the database rather than here - the point of
	 * that key is that no service has to remember the check.
	 *
	 * `components` is accepted only on a bundle, and a bundle with choices to make is refused
	 * without them - both answered by `CartService.addItem` against the live composition.
	 */
	readonly addItem = z.object({
		variant_id: this.validateId(this.getMessage('invalid_variant_id')),
		product_id: this.validateId(this.getMessage('invalid_product_id')),
		quantity: this.quantitySchema(),
		options: this.optionsSchema(),
		components: this.componentsSchema(),
		notes: this.notesSchema(),
	});

	readonly updateItem = z
		.object({
			id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
			quantity: this.quantitySchema().optional(),
			notes: this.notesSchema(),
		})
		.refine((data) => hasAtLeastOneValue(data, paramsItemUpdateList), {
			message: this.getMessage('params_at_least_one', {
				params: paramsItemUpdateList.join(', '),
			}),
			path: ['_global'],
		});

	readonly removeItem = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly setCurrency = z.object({
		currency: this.currencySchema(true),
	});

	/**
	 * Checkout. The client is named by the caller because an account may hold several - billing
	 * privately or through a company is the shopper's choice. Whether the named client is one the
	 * caller holds is not a shape question and is answered by `CartService.toOrder`.
	 */
	readonly checkout = z.object({
		client_id: this.validateId(this.getMessage('invalid_client_id')),
		notes: this.notesSchema(),
	});

	readonly read = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	readonly delete = z.object({
		id: this.validateId(this.getMessage('invalid_id', { name: 'id' })),
	});

	/**
	 * The dashboard listing. `token` is not a filter: it is the guest's credential, and a
	 * back-office search by it would turn a support screen into a way to open any cart.
	 *
	 * There is no status and no `is_deleted` either - a cart is a live basket or it does not
	 * exist, so every row here is one somebody is carrying right now.
	 */
	readonly find = this.validateFind({
		orderByEnum: OrderByEnum,
		defaultOrderBy: OrderByEnum.UPDATED_AT,

		directionEnum: OrderDirectionEnum,
		defaultDirection: OrderDirectionEnum.DESC,

		defaultLimit: Configuration.get('filter.limit'),
		defaultPage: 1,

		filterSchema: {
			user_id: this.validateId(
				this.getMessage('invalid_id', { name: 'user_id' }),
				{ required: false },
			),
			currency: this.currencySchema(false),
		},
	});
}
