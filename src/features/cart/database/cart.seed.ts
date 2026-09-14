import { IsNull, Not } from 'typeorm';
import { Configuration } from '@/config/settings.config';
import {
	isDirectRun,
	loadIds,
	type Random,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import CartEntity, { CART_TTL_SECONDS } from '@/features/cart/cart.entity';
import { normalizeOptions } from '@/features/cart/cart.service';
import CartItemEntity from '@/features/cart/cart-item.entity';
import ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import UserEntity from '@/features/user/user.entity';
import { createFutureDate, createPastDate } from '@/helpers/date.helper';

const TARGET_CARTS = 12;
const MIN_LINES_PER_CART = 1;
const MAX_LINES_PER_CART = 4;

/**
 * How many of the seeded carts are already past their expiry: one in four, so a local database has
 * something for the cleanup cron to find without the table being mostly rubbish. They are ordinary
 * rows in every other respect - a cart has no state saying it expired, only a date that has passed.
 */
const EXPIRED_EVERY = 4;

/**
 * The natural key: `token` is unique, so a deterministic one per index makes a re-run recognize
 * the carts it already wrote. Shaped as a real v4 uuid because the column is `uuid` and Postgres
 * will not take anything else - the randomness is what a seed has to give up, not the format.
 */
function seedToken(index: number): string {
	const tail = index.toString().padStart(12, '0');

	return `00000000-0000-4000-8000-${tail}`;
}

/**
 * Baskets somebody is still filling, plus a few whose expiry has already passed. Roughly half are
 * attached to a seeded account and the rest are guests, which is the split the merge-at-login path
 * has to cope with.
 */
export const cartSeed: SeedDefinition = {
	name: 'cart',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(CartEntity);
		const itemRepository = manager.getRepository(CartItemEntity);

		const variantRows = await manager
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true, product_id: true },
				order: { id: 'ASC' },
			});

		const userIds = await loadIds(manager, UserEntity);

		if (variantRows.length === 0) {
			return {
				entity: 'cart',
				alreadyPresent: 0,
				inserted: 0,
				target: 0,
				tableTotal: await repository.count(),
			};
		}

		/*
		 * The questions each product asks, keyed by product. A seeded line has to answer them the
		 * way `CartService.addItem` would accept - its own product's answers, every group within
		 * `min_select` / `max_select` - or the pricing pass reports the line as broken. Seeds
		 * bypass the service, so the seed has to get it right itself.
		 */
		const groupRows = await manager
			.getRepository(ProductOptionGroupEntity)
			.find({
				relations: { options: true },
				order: { id: 'ASC', options: { id: 'ASC' } },
			});

		const groupsByProduct = new Map<number, ProductOptionGroupEntity[]>();

		for (const group of groupRows) {
			group.options = group.options ?? [];

			const bucket = groupsByProduct.get(group.product_id) ?? [];

			bucket.push(group);
			groupsByProduct.set(group.product_id, bucket);
		}

		const existingTokens = new Set(
			(await repository.find({ select: { token: true } })).map(
				(row) => row.token,
			),
		);

		/*
		 * The accounts holding no cart yet. `UQ_cart_user` is unqualified - one per user, with no
		 * status or `deleted_at` left to scope it - so a cart created by hand while testing holds
		 * its user's only slot. The natural key here is `token`, which cannot see that: it
		 * recognizes the seed's own rows and nothing else. Claiming from a pool of free accounts
		 * is what keeps a re-run a top-up rather than a unique violation.
		 */
		const takenUserIds = new Set(
			(
				await repository.find({
					select: { user_id: true },
					where: { user_id: Not(IsNull()) },
				})
			).map((row) => row.user_id),
		);

		const freeUserIds = userIds.filter((id) => !takenUserIds.has(id));

		const currency = Configuration.currency();

		let inserted = 0;
		let alreadyPresent = 0;

		for (let index = 0; index < TARGET_CARTS; index++) {
			const token = seedToken(index);

			if (existingTokens.has(token)) {
				alreadyPresent++;

				continue;
			}

			const isExpired = index % EXPIRED_EVERY === EXPIRED_EVERY - 1;

			const cart = await repository.save(
				repository.create({
					token: token,
					// Every second cart belongs to an account, drawn from those that have
					// none. Once the pool runs dry the remainder are guest carts - a split
					// the merge-at-login path has to cope with anyway.
					user_id:
						index % 2 === 0 ? (freeUserIds.shift() ?? null) : null,
					currency: currency,
					expires_at: isExpired
						? createPastDate(randomInt(random, 1, 30) * 86400)
						: createFutureDate(CART_TTL_SECONDS),
				}),
			);

			const lineCount = Math.min(
				randomInt(random, MIN_LINES_PER_CART, MAX_LINES_PER_CART),
				variantRows.length,
			);

			const usedVariants = new Set<number>();
			const lines: Partial<CartItemEntity>[] = [];

			for (let line = 0; line < lineCount; line++) {
				const variant = randomPick(random, variantRows);

				// One line per variant per cart here, rather than relying on the unique
				// index to reject the repeat: a duplicate would only differ by its option
				// set, and the seed has no reason to produce that shape.
				if (usedVariants.has(variant.id)) {
					continue;
				}

				usedVariants.add(variant.id);

				const chosen = chooseOptions(
					groupsByProduct.get(variant.product_id) ?? [],
					random,
				);

				const { options, hash } = normalizeOptions(chosen);

				lines.push({
					cart_id: cart.id,
					variant_id: variant.id,
					product_id: variant.product_id,
					quantity: randomInt(random, 1, 3),
					options: options,
					options_hash: hash,
					notes: null,
				});
			}

			if (lines.length > 0) {
				await itemRepository.save(
					lines.map((line) => itemRepository.create(line)),
				);
			}

			existingTokens.add(token);

			inserted++;
		}

		return {
			entity: 'cart',
			alreadyPresent: alreadyPresent,
			inserted: inserted,
			target: TARGET_CARTS,
			tableTotal: await repository.count(),
		};
	},
};

/**
 * One admissible answer set for a product: every required question gets exactly its minimum, and an
 * optional one is answered a third of the time, so the hashing and the delta arithmetic are both
 * represented rather than assumed. Answers are taken from a random starting point within the group,
 * and never more than the group offers - `ProductValidator` keeps `min_select` within that count.
 */
function chooseOptions(
	groups: readonly ProductOptionGroupEntity[],
	random: Random,
): number[] {
	const chosen: number[] = [];

	for (const group of groups) {
		const available = (group.options ?? []).map((option) => option.id);

		if (available.length === 0) {
			continue;
		}

		const wanted =
			group.min_select > 0
				? group.min_select
				: group.max_select !== 0 && randomInt(random, 0, 2) === 0
					? 1
					: 0;

		const start = randomInt(random, 0, available.length - 1);

		for (
			let offset = 0;
			offset < Math.min(wanted, available.length);
			offset++
		) {
			chosen.push(available[(start + offset) % available.length]);
		}
	}

	return chosen;
}

if (isDirectRun(import.meta.url)) {
	await runSeedFile(cartSeed);
}
