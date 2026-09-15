import { Configuration } from '@/config/settings.config';
import {
	isDirectRun,
	loadIds,
	randomInt,
	randomPastDate,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ClientEntity from '@/features/client/client.entity';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import { documentSeriesService } from '@/features/document-series/document-series.service';
import OrderEntity, {
	type OrderStatus,
	OrderStatusEnum,
	OrderTypeEnum,
} from '@/features/order/order.entity';
import OrderLineEntity from '@/features/order/order-line.entity';
import ProductEntity from '@/features/product/product.entity';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { resolveVatRate, roundMoney } from '@/helpers/shop.helper';

const TARGET = 24;
const MIN_LINES_PER_ORDER = 1;
const MAX_LINES_PER_ORDER = 4;

/** How far back the order book stretches, so the date filters have something to narrow. */
const ISSUED_WITHIN_DAYS = 180;

/**
 * The mix a live order book settles into: most documents made it through, a few are still moving,
 * and a small tail was withdrawn.
 */
const STATUSES: readonly OrderStatus[] = [
	OrderStatusEnum.COMPLETED,
	OrderStatusEnum.COMPLETED,
	OrderStatusEnum.COMPLETED,
	OrderStatusEnum.CONFIRMED,
	OrderStatusEnum.CONFIRMED,
	OrderStatusEnum.PENDING,
	OrderStatusEnum.CANCELLED,
];

type SellableVariant = {
	variant_id: number;
	product_id: number;
	price: number;
	vat_rate: number;
};

/**
 * Demo orders, each with its lines, priced off the catalog as it stands.
 *
 * **The natural key is the row count, not a value on the row** - the exception to the rule the
 * other seeds follow. A document is identified by the number its series hands out, and that number
 * cannot be a pure function of the loop index: the counter is shared with every order the
 * application itself raises, so a re-run would either collide with `IDX_order_ref` or quietly claim
 * numbers belonging to real documents. Counting instead means a re-run tops the table up to
 * `TARGET` and stops, which is the same promise `topUp` makes by a different route.
 *
 * Numbers are allocated through `documentSeriesService`, in the seed's own transaction, exactly as
 * the application does - so the series is left consistent rather than stepped over.
 */
export const orderSeed: SeedDefinition = {
	name: 'order',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(OrderEntity);
		const lineRepository = manager.getRepository(OrderLineEntity);

		const currency = Configuration.currency();

		const clientIds = await loadIds(manager, ClientEntity);

		/*
		 * Only variants with a price row in the base currency can be sold: a line has to carry a
		 * figure, and inventing one would put a number in the order book that the catalog cannot
		 * account for. The product comes along for its `vat_category`, which is what the stored
		 * rate is resolved from - the same call `CartService.toOrder` makes at checkout.
		 */
		const priced = await manager
			.getRepository(ProductVariantEntity)
			.createQueryBuilder('variant')
			.innerJoin(
				ProductPriceEntity,
				'price',
				'price.variant_id = variant.id AND price.currency = :currency AND price.deleted_at IS NULL',
				{ currency: currency },
			)
			.innerJoin(
				ProductEntity,
				'product',
				'product.id = variant.product_id AND product.deleted_at IS NULL',
			)
			.where('variant.deleted_at IS NULL')
			.select([
				'variant.id AS variant_id',
				'variant.product_id AS product_id',
				'price.sale_price AS sale_price',
				'product.vat_category AS vat_category',
			])
			.orderBy('variant.id', 'ASC')
			.getRawMany<{
				variant_id: number;
				product_id: number;
				sale_price: string;
				vat_category: ProductEntity['vat_category'];
			}>();

		const sellable: SellableVariant[] = priced.map((row) => ({
			variant_id: Number(row.variant_id),
			product_id: Number(row.product_id),
			price: Number(row.sale_price),
			vat_rate: resolveVatRate(row.vat_category),
		}));

		const tableTotal = await repository.count({ withDeleted: true });

		if (clientIds.length === 0 || sellable.length === 0) {
			return {
				entity: 'order',
				alreadyPresent: tableTotal,
				inserted: 0,
				target: 0,
				tableTotal: tableTotal,
			};
		}

		const missing = Math.max(0, TARGET - tableTotal);

		for (let index = 0; index < missing; index++) {
			const reference = await documentSeriesService.allocate(
				manager,
				DocumentTypeEnum.ORDER,
			);

			const status = randomPick(random, STATUSES);

			const order = await repository.save(
				repository.create({
					client_id: randomPick(random, clientIds),
					ref_code: reference.code,
					ref_number: reference.number,
					status: status,
					// Subscriptions raise their own orders, and nothing here renews anything -
					// a `subscription` order with no subscription behind it would be a shape
					// the application never produces.
					type: OrderTypeEnum.STANDARD,
					issued_at: randomPastDate(random, ISSUED_WITHIN_DAYS),
					notes: null,
				}),
			);

			const lineCount = Math.min(
				randomInt(random, MIN_LINES_PER_ORDER, MAX_LINES_PER_ORDER),
				sellable.length,
			);

			const usedVariants = new Set<number>();
			const lines: Partial<OrderLineEntity>[] = [];

			for (let line = 0; line < lineCount; line++) {
				const pick = randomPick(random, sellable);

				// One line per variant, as a basket reads: buying the same thing twice is a
				// quantity, not a second line.
				if (usedVariants.has(pick.variant_id)) {
					continue;
				}

				usedVariants.add(pick.variant_id);

				lines.push({
					order_id: order.id,
					parent_id: null,
					variant_id: pick.variant_id,
					product_id: pick.product_id,
					quantity: randomInt(random, 1, 3),
					vat_rate: pick.vat_rate,
					price: roundMoney(pick.price),
					currency: currency,
					// Base currency throughout, so the rate is the identity. A seeded order in
					// a second currency would need a published rate for its own issue date.
					exchange_rate: 1,
					discount: undefined,
					discount_reduction: 0,
					options: undefined,
					notes: null,
				});
			}

			await lineRepository.save(lines);
		}

		return {
			entity: 'order',
			alreadyPresent: Math.min(tableTotal, TARGET),
			inserted: missing,
			target: TARGET,
			tableTotal: tableTotal + missing,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(orderSeed);
}
