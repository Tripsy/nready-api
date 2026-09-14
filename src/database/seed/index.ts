import { discountTargetSeed } from '@/database/seed/discount-target.seed';
import type { SeedDefinition } from '@/database/seed/seed.helper';
import { bootstrapSeeds } from '@/database/seed/seed.runner';
import { addressSeed } from '@/features/address/database/address.seed';
import { articleSeed } from '@/features/article/database/article.seed';
import { brandSeed } from '@/features/brand/database/brand.seed';
import { carrierSeed } from '@/features/carrier/database/carrier.seed';
import { cartSeed } from '@/features/cart/database/cart.seed';
import { cashFlowSeed } from '@/features/cash-flow/database/cash-flow.seed';
import { categorySeed } from '@/features/category/database/category.seed';
import { clientSeed } from '@/features/client/database/client.seed';
import { clientAddressSeed } from '@/features/client-address/database/client-address.seed';
import { commentSeed } from '@/features/comment/database/comment.seed';
import { complaintSeed } from '@/features/complaint/database/complaint.seed';
import { discountSeed } from '@/features/discount/database/discount.seed';
import { documentSeriesSeed } from '@/features/document-series/database/document-series.seed';
import { imageSeed } from '@/features/image/database/image.seed';
import { orderSeed } from '@/features/order/database/order.seed';
import { placeSeed } from '@/features/place/database/place.seed';
import { productSeed } from '@/features/product/database/product.seed';
import { ratingSeed } from '@/features/rating/database/rating.seed';
import { reviewSeed } from '@/features/review/database/review.seed';
import { termSeed } from '@/features/term/database/term.seed';
import { userSeed } from '@/features/user/database/user.seed';
import { vendorSeed } from '@/features/vendor/database/vendor.seed';
import { warehouseSeed } from '@/features/warehouse/database/warehouse.seed';

/**
 * Declaration order is the foreign-key order and is not arbitrary: `place → address`, and
 * a seed reads the ids of its parents, so moving one earlier makes it find nothing.
 *
 * The `permission` and `template` seeds are not listed. They are reference data with
 * wipe-and-insert semantics, not demo volume, and are run on their own - as is
 * `account/database/admin.seed.ts`, which is keyed to `ADMIN_EMAIL`/`ADMIN_PASSWORD` and
 * would make `pnpm run seed` require an environment to be configured.
 */
const seeds: readonly SeedDefinition[] = [
	// No parents; the documents that draw from it are seeded later
	documentSeriesSeed,
	placeSeed,
	addressSeed,
	brandSeed,
	carrierSeed,
	// Reads address ids
	warehouseSeed,
	categorySeed,
	vendorSeed,
	userSeed,
	// Reads user ids - most clients are linked to the account that holds them
	clientSeed,
	// Reads client and address ids - a client address points at an existing address
	clientAddressSeed,
	cashFlowSeed,
	termSeed,
	// Reads category, term, brand ids; seeds the category attribute definitions
	// its products answer to before the products themselves
	productSeed,
	discountSeed,
	// Reads discount ids alongside client, category and brand ids
	discountTargetSeed,
	// Reads category, term and user ids
	articleSeed,
	// Reads article ids; the files it names are fetched separately (see the seed)
	imageSeed,
	// Reads article and user ids
	ratingSeed,
	// Reads article and user ids; replies are inserted after the roots they hang from
	commentSeed,
	// Reads article, comment and user ids
	complaintSeed,
	// Reads product variant, product option and user ids; the lines cite variants, so it has to
	// follow `productSeed`
	cartSeed,
	// Reads client ids and priced product variants; allocates its numbers from the `ORD` series,
	// so it has to follow `documentSeriesSeed` as well
	orderSeed,
	// Reads product, product variant and user ids, and the completed orders a verified review
	// names - so it has to follow `orderSeed`
	reviewSeed,
];

function resolveSeeds(
	requested: string | undefined,
): readonly SeedDefinition[] {
	if (!requested) {
		return seeds;
	}

	const match = seeds.find((seed) => seed.name === requested);

	if (!match) {
		const available = seeds.map((seed) => seed.name).join(', ');

		throw new Error(`Unknown seed "${requested}". Available: ${available}`);
	}

	return [match];
}

try {
	const selected = resolveSeeds(process.argv[2]);

	const summaries = await bootstrapSeeds(selected, 'seed.orchestrator');

	const inserted = summaries.reduce(
		(total, summary) => total + summary.inserted,
		0,
	);

	console.info(
		`Seeding finished - ${inserted} row(s) inserted across ${summaries.length} entit${summaries.length === 1 ? 'y' : 'ies'} ✅`,
	);

	process.exit(0);
} catch (error) {
	console.error('Seeding failed:', error);
	process.exit(1);
}
