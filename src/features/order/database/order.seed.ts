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
import ClientAddressEntity, {
	ClientAddressTypeEnum,
} from '@/features/client-address/client-address.entity';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import { documentSeriesService } from '@/features/document-series/document-series.service';
import OrderEntity, {
	type OrderBillingAddress,
	type OrderPaymentMethod,
	OrderPaymentMethodEnum,
	type OrderStatus,
	OrderStatusEnum,
} from '@/features/order/order.entity';
import OrderLineEntity from '@/features/order/order-line.entity';
import type PlaceEntity from '@/features/place/place.entity';
import { type PlaceType, PlaceTypeEnum } from '@/features/place/place.entity';
import ProductEntity from '@/features/product/product.entity';
import ProductPriceEntity from '@/features/product/product-price.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { resolveVatRate, roundMoney } from '@/helpers/shop.helper';

const TARGET = 24;
const MIN_LINES_PER_ORDER = 1;
const MAX_LINES_PER_ORDER = 4;

/** How far back the order book stretches, so the date filters have something to narrow. */
const CREATED_WITHIN_DAYS = 180;

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
	OrderStatusEnum.CANCELED,
];

/**
 * How the buyer said they would pay. Weighted towards card, the way an online shop's mix runs.
 *
 * Stated on every seeded order rather than left null: it is what `cashFlowSeed` turns into the
 * method on the payment request it raises for a pending order, so a null here would seed a shop
 * whose every request reads as a bank transfer. A back-office order that names none is a real
 * shape, but it is the exception and not worth the whole demo looking like one.
 */
const PAYMENT_METHODS: readonly OrderPaymentMethod[] = [
	OrderPaymentMethodEnum.CARD,
	OrderPaymentMethodEnum.CARD,
	OrderPaymentMethodEnum.CARD,
	OrderPaymentMethodEnum.CASH_ON_DELIVERY,
	OrderPaymentMethodEnum.CASH_ON_DELIVERY,
	OrderPaymentMethodEnum.BANK_TRANSFER,
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
/**
 * A client billing address flattened the way `ClientAddressService.getBillingCopy` flattens it,
 * built from rows already loaded through the seed's manager - the service reads committed data,
 * and the seed runs inside the transaction that wrote the addresses.
 */
function toBillingSnapshot(entry: ClientAddressEntity): OrderBillingAddress {
	const city = entry.address?.city ?? null;
	const chain = [city, city?.parent, city?.parent?.parent].filter(
		(place): place is PlaceEntity => !!place,
	);
	const language = Configuration.language();
	const placeOf = (type: PlaceType) =>
		chain.find((place) => place.place_type === type);
	const nameOf = (type: PlaceType): string | null => {
		const contents = placeOf(type)?.contents ?? [];

		return (
			contents.find((content) => content.language === language)?.name ??
			contents[0]?.name ??
			null
		);
	};
	const details = [entry.address?.details, entry.details]
		.filter((part): part is string => !!part)
		.join(', ');

	return {
		details: details || null,
		postal_code: entry.address?.postal_code ?? null,
		address_city: nameOf(PlaceTypeEnum.CITY),
		address_region: nameOf(PlaceTypeEnum.REGION),
		address_country: nameOf(PlaceTypeEnum.COUNTRY),
		country_code: placeOf(PlaceTypeEnum.COUNTRY)?.alpha2_code ?? null,
		notes: entry.notes,
	};
}

export const orderSeed: SeedDefinition = {
	name: 'order',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(OrderEntity);
		const lineRepository = manager.getRepository(OrderLineEntity);

		const currency = Configuration.currency();

		const clientIds = await loadIds(manager, ClientEntity);

		/*
		 * The address each client is billed at, first by id. An order with none cannot be
		 * invoiced - issuing refuses a document with nowhere to be sent - so buyers are drawn from
		 * the clients that have one, and only a book with no billing address anywhere falls back
		 * to every client.
		 */
		const billingAddresses = await manager
			.getRepository(ClientAddressEntity)
			.find({
				where: { type: ClientAddressTypeEnum.BILLING },
				relations: {
					address: {
						city: {
							contents: true,
							parent: {
								contents: true,
								parent: { contents: true },
							},
						},
					},
				},
				order: { id: 'ASC' },
			});

		// Copied onto each order the way checkout copies it - the order keeps its own snapshot
		const billingAddressByClient = new Map<number, OrderBillingAddress>();

		for (const address of billingAddresses) {
			if (!billingAddressByClient.has(address.client_id)) {
				billingAddressByClient.set(
					address.client_id,
					toBillingSnapshot(address),
				);
			}
		}

		const billableClientIds = clientIds.filter((id) =>
			billingAddressByClient.has(id),
		);
		const buyerIds =
			billableClientIds.length > 0 ? billableClientIds : clientIds;

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
			const clientId = randomPick(random, buyerIds);

			const order = await repository.save(
				repository.create({
					client_id: clientId,
					billing_address:
						billingAddressByClient.get(clientId) ?? null,
					ref_code: reference.code,
					ref_number: reference.number,
					status: status,
					payment_method: randomPick(random, PAYMENT_METHODS),
					created_at: randomPastDate(random, CREATED_WITHIN_DAYS),
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
					// a second currency would need a published rate for its own creation date.
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
