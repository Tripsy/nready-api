import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import DiscountEntity, {
	type DiscountConditions,
	type DiscountReason,
	DiscountReasonEnum,
	type DiscountScope,
	DiscountScopeEnum,
	type DiscountType,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';

const DAY_IN_MILLISECONDS = 86400 * 1000;

/**
 * Offsets, in days from now, for the discount window. `null` on either end means open-ended.
 * The set deliberately covers all four states the `IDX_discount_active` lookup has to tell
 * apart - running, scheduled, expired and always-on - so a demo list is not uniformly valid.
 */
type Window = readonly [startDays: number | null, endDays: number | null];

const WINDOW_RUNNING: Window = [-7, 21];
const WINDOW_SCHEDULED: Window = [14, 45];
const WINDOW_EXPIRED: Window = [-90, -30];
const WINDOW_OPEN: Window = [null, null];

type DiscountBlueprint = {
	/** Natural key: the coupon / referral code a client actually types. */
	reference: string;
	label: string;
	scope: DiscountScope;
	reason: DiscountReason;
	type: DiscountType;
	value: number;
	window: Window;
	/**
	 * Built per row rather than stored flat, because the meaningful rule keys follow the
	 * scope - an order-wide discount is bounded by `applicable_countries` or
	 * `min_order_value`.
	 *
	 * Conditions gate *when* a discount applies. What it attaches to lives in `discount_target`,
	 * so no condition key names an entity id.
	 */
	buildConditions: () => DiscountConditions | undefined;
	notes: string | null;
};

const DISCOUNTS: readonly DiscountBlueprint[] = [
	{
		reference: 'FLASH10',
		label: 'Flash Sale 10%',
		scope: DiscountScopeEnum.ORDER,
		reason: DiscountReasonEnum.FLASH_SALE,
		type: DiscountTypeEnum.PERCENT,
		value: 10,
		window: WINDOW_RUNNING,
		buildConditions: () => ({ min_order_value: 150 }),
		notes: 'Site-wide weekend campaign',
	},
	{
		reference: 'WELCOME25',
		label: 'Welcome Voucher',
		scope: DiscountScopeEnum.CLIENT,
		reason: DiscountReasonEnum.FIRST_TIME_CUSTOMER,
		type: DiscountTypeEnum.AMOUNT,
		value: 25,
		window: WINDOW_OPEN,
		buildConditions: () => ({ min_order_value: 200 }),
		notes: 'First order only',
	},
	{
		reference: 'LOYAL5',
		label: 'Loyalty Reward 5%',
		scope: DiscountScopeEnum.CLIENT,
		reason: DiscountReasonEnum.LOYALTY_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 5,
		window: WINDOW_OPEN,
		buildConditions: () => ({ min_order_value: 250 }),
		notes: null,
	},
	{
		reference: 'BDAY15',
		label: 'Birthday Treat 15%',
		scope: DiscountScopeEnum.CLIENT,
		reason: DiscountReasonEnum.BIRTHDAY_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 15,
		window: WINDOW_OPEN,
		buildConditions: () => undefined,
		notes: 'Valid during the birthday month',
	},
	{
		reference: 'REFER20',
		label: 'Referral Bonus',
		scope: DiscountScopeEnum.CLIENT,
		reason: DiscountReasonEnum.REFERRAL_DISCOUNT,
		type: DiscountTypeEnum.AMOUNT,
		value: 20,
		window: WINDOW_RUNNING,
		buildConditions: () => ({ min_order_value: 100 }),
		notes: 'Granted to the referring client',
	},
	{
		reference: 'VIP12',
		label: 'VIP Tier 12%',
		scope: DiscountScopeEnum.CLIENT,
		reason: DiscountReasonEnum.VIP_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 12,
		window: WINDOW_OPEN,
		buildConditions: () => ({ hour_range: [10, 18] }),
		notes: null,
	},
	{
		reference: 'CAT20',
		label: 'Category Clearance 20%',
		scope: DiscountScopeEnum.CATEGORY,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 20,
		window: WINDOW_RUNNING,
		buildConditions: () => undefined,
		notes: 'Ends when the stock is out',
	},
	{
		reference: 'CATFIX30',
		label: 'Category Fixed Cut',
		scope: DiscountScopeEnum.CATEGORY,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.AMOUNT,
		value: 30,
		window: WINDOW_SCHEDULED,
		buildConditions: () => ({ min_order_value: 250 }),
		notes: null,
	},
	{
		reference: 'PROD7',
		label: 'Product Promo 7%',
		scope: DiscountScopeEnum.PRODUCT,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 7,
		window: WINDOW_RUNNING,
		buildConditions: () => undefined,
		notes: 'Linked to products through discount_target',
	},
	{
		reference: 'PRODLAUNCH',
		label: 'Launch Offer 18%',
		scope: DiscountScopeEnum.PRODUCT,
		reason: DiscountReasonEnum.FLASH_SALE,
		type: DiscountTypeEnum.PERCENT,
		value: 18,
		window: WINDOW_SCHEDULED,
		buildConditions: () => undefined,
		notes: null,
	},
	{
		reference: 'VAR12',
		label: 'Variant Clearance 12%',
		scope: DiscountScopeEnum.VARIANT,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 12,
		window: WINDOW_RUNNING,
		buildConditions: () => undefined,
		notes: 'One size or colour marked down, not the whole product',
	},
	{
		reference: 'VARFIX5',
		label: 'Variant Fixed Cut',
		scope: DiscountScopeEnum.VARIANT,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.AMOUNT,
		value: 5,
		window: WINDOW_OPEN,
		buildConditions: () => undefined,
		notes: null,
	},
	{
		reference: 'RO8',
		label: 'Romania Shipping Offset',
		scope: DiscountScopeEnum.ORDER,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.AMOUNT,
		value: 8,
		window: WINDOW_OPEN,
		buildConditions: () => ({
			applicable_countries: ['RO'],
			min_order_value: 120,
		}),
		notes: null,
	},
	{
		reference: 'EU5',
		label: 'EU Cross-Border 5%',
		scope: DiscountScopeEnum.ORDER,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 5,
		window: WINDOW_SCHEDULED,
		// PL is not among the seeded places, so this one demonstrates a campaign whose country
		// list reaches beyond the catalog's own countries
		buildConditions: () => ({ applicable_countries: ['BG', 'HU', 'PL'] }),
		notes: null,
	},
	{
		reference: 'BF2025',
		label: 'Black Friday 2025',
		scope: DiscountScopeEnum.ORDER,
		reason: DiscountReasonEnum.FLASH_SALE,
		type: DiscountTypeEnum.PERCENT,
		value: 30,
		window: WINDOW_EXPIRED,
		buildConditions: () => ({ min_order_value: 100 }),
		notes: 'Kept as an expired campaign',
	},
	{
		reference: 'SUMMER24',
		label: 'Summer Sale 2024',
		scope: DiscountScopeEnum.CATEGORY,
		reason: DiscountReasonEnum.SPECIAL_DISCOUNT,
		type: DiscountTypeEnum.AMOUNT,
		value: 15,
		window: WINDOW_EXPIRED,
		buildConditions: () => undefined,
		notes: 'Kept as an expired campaign',
	},
	{
		reference: 'BRAND10',
		label: 'Brand Partner 10%',
		scope: DiscountScopeEnum.BRAND,
		reason: DiscountReasonEnum.LOYALTY_DISCOUNT,
		type: DiscountTypeEnum.PERCENT,
		value: 10,
		window: WINDOW_RUNNING,
		buildConditions: () => undefined,
		notes: null,
	},
];

const TARGET = DISCOUNTS.length;

function resolveDate(offsetInDays: number | null): Date | null {
	return offsetInDays === null
		? null
		: new Date(Date.now() + offsetInDays * DAY_IN_MILLISECONDS);
}

export const discountSeed: SeedDefinition = {
	name: 'discount',
	run: async ({ manager }): Promise<SeedSummary> => {
		return topUp({
			entity: 'discount',
			target: TARGET,
			manager,
			entityClass: DiscountEntity,
			// `label` repeats across campaigns; the coupon code is what identifies a row
			keyColumn: 'reference',
			buildRow: (index) => {
				const blueprint = DISCOUNTS[index];
				const [startDays, endDays] = blueprint.window;

				return {
					label: blueprint.label,
					scope: blueprint.scope,
					reason: blueprint.reason,
					reference: blueprint.reference,
					type: blueprint.type,
					conditions: blueprint.buildConditions(),
					value: blueprint.value,
					start_at: resolveDate(startDays),
					end_at: resolveDate(endDays),
					notes: blueprint.notes,
				};
			},
		});
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(discountSeed);
}
