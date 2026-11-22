import {
	isDirectRun,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import { resolveBaseCurrency } from '@/features/exchange-rate/exchange-rate.entity';
import GrnEntity from '@/features/grn/grn.entity';
import { grnService } from '@/features/grn/grn.service';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import VendorEntity, {
	VendorStatusEnum,
	VendorTypeEnum,
} from '@/features/vendor/vendor.entity';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';

const TARGET = 12;

/** A week between deliveries, oldest first, so the FIFO order reads the way the numbers run. */
const DAYS_BETWEEN = 7;

/** The last receipt stays a draft, and one in every six is confirmed and then taken back. */
const CANCEL_EVERY = 6;

const SUPPLIER_DOCUMENT_PREFIX = 'DEMO-AVZ-';

/** A receipt that ends up holding stock: confirmed and never canceled. */
const isStocking = (index: number): boolean =>
	index < TARGET - 1 && (index + 1) % CANCEL_EVERY !== 0;

/** The indexes of the stocking receipts, in order. */
const STOCKING_INDEXES = Array.from(
	{ length: TARGET },
	(_, index) => index,
).filter(isStocking);

/**
 * The variants a stocking receipt takes: every `STOCKING_INDEXES.length`-th tracked variant from
 * its own position, and again from half a turn further on - so the confirmed receipts between
 * them cover the whole catalog twice. Received twice, a variant usually sits in two warehouses,
 * which is what lets `shippingSeed` split an order across two sites that can each send their half.
 */
function stockedLines<T>(index: number, variants: readonly T[]): T[] {
	const count = STOCKING_INDEXES.length;
	const position = STOCKING_INDEXES.indexOf(index);
	const second = (position + Math.floor(count / 2)) % count;

	return variants.filter(
		(_, variantIndex) =>
			variantIndex % count === position ||
			variantIndex % count === second,
	);
}

const naturalKey = (index: number): string =>
	`${SUPPLIER_DOCUMENT_PREFIX}${sequenceLabel(index)}`;

/**
 * Demo goods receipts, written and confirmed through `GrnService` in the seed's own transaction -
 * so the lots, the receipt movements, the reversals and the re-averaged `cost_price` are what the
 * application itself produces, not hand-built rows that could disagree with the ledger.
 *
 * The natural key is the supplier document number (`DEMO-AVZ-0001`): a receipt is written only for
 * a key not stored yet, so a re-run tops the table up rather than receiving the same goods twice.
 *
 * Received in the base currency, against stock-tracked variants only. A unit cost is drawn around
 * the variant's current `cost_price`, so the averages move the way a real catalog's would rather
 * than jumping between unrelated figures.
 *
 * Statuses: the newest receipt stays `draft`, every sixth is confirmed then `canceled` (the
 * reversal path, which a fresh lot always allows), the rest are `confirmed`.
 *
 * **Every stock-tracked variant is received, twice**: the receipts that stay confirmed share the
 * tracked variants round-robin (`stockedLines`), so the order and shipping seeds can sell any of
 * them and split an order across two sites. The draft and the canceled ones take a random run of variants, since they stock
 * nothing.
 */
export const grnSeed: SeedDefinition = {
	name: 'grn',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(GrnEntity);

		const warehouses = await manager.getRepository(WarehouseEntity).find({
			select: { id: true },
			where: { status: WarehouseStatusEnum.ACTIVE },
			order: { id: 'ASC' },
		});

		const suppliers = await manager.getRepository(VendorEntity).find({
			select: { id: true },
			where: {
				type: VendorTypeEnum.SUPPLIER,
				status: VendorStatusEnum.ACTIVE,
			},
			order: { id: 'ASC' },
		});

		const variants = await manager
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true, cost_price: true },
				where: { track_stock: true },
				order: { id: 'ASC' },
			});

		const existing = new Set(
			(
				await repository.find({
					select: { supplier_document_number: true },
					withDeleted: true,
				})
			).map((entry) => entry.supplier_document_number),
		);

		const summary = (inserted: number): Promise<SeedSummary> =>
			repository.count({ withDeleted: true }).then((tableTotal) => ({
				entity: 'grn',
				alreadyPresent: TARGET - inserted - countMissing(existing),
				inserted: inserted,
				target: TARGET,
				tableTotal: tableTotal,
			}));

		if (
			warehouses.length === 0 ||
			suppliers.length === 0 ||
			variants.length === 0
		) {
			return summary(0);
		}

		const baseCurrency = resolveBaseCurrency();

		let inserted = 0;

		for (let index = 0; index < TARGET; index++) {
			/*
			 * Drawn before the skip, so every candidate consumes the same random numbers whether or
			 * not it is written - the rows stay a pure function of the index across re-runs.
			 */
			const warehouseId = randomPick(random, warehouses).id;
			const vendorId = randomPick(random, suppliers).id;
			const lineCount = randomInt(
				random,
				1,
				Math.min(5, variants.length),
			);
			const offset = randomInt(random, 0, variants.length - 1);
			const share = isStocking(index)
				? stockedLines(index, variants)
				: [];
			// A catalog smaller than the stocking receipts leaves some with no share of their own
			const picked =
				share.length > 0
					? share
					: Array.from(
							{ length: lineCount },
							(_, line) =>
								variants[(offset + line) % variants.length],
						);
			const lines = picked.map((variant) => {
				const reference = Number(variant.cost_price ?? 0) || 10;

				return {
					variant_id: variant.id,
					qty: randomInt(random, 5, 120),
					// Within 15% of the current cost, to the cent
					unit_cost:
						Math.round(reference * (0.85 + random() * 0.3) * 100) /
						100,
					vat_rate: 21,
				};
			});

			const key = naturalKey(index);

			if (existing.has(key)) {
				continue;
			}

			const receivedAt = new Date();
			receivedAt.setHours(0, 0, 0, 0);
			receivedAt.setDate(
				receivedAt.getDate() - (TARGET - index) * DAYS_BETWEEN,
			);

			const entry = await grnService.createWithin(manager, {
				warehouse_id: warehouseId,
				vendor_id: vendorId,
				supplier_document_number: key,
				received_at: receivedAt,
				currency: baseCurrency,
				exchange_rate: 1,
				notes: undefined,
				items: lines.map((line) => ({
					...line,
					lot_code: undefined,
					expires_at: undefined,
					notes: undefined,
				})),
			});

			if (index < TARGET - 1) {
				await grnService.confirmWithin(manager, entry.id);

				if ((index + 1) % CANCEL_EVERY === 0) {
					await grnService.cancelWithin(manager, entry.id);
				}
			}

			existing.add(key);
			inserted++;
		}

		return summary(inserted);
	},
};

function countMissing(existing: Set<string | null>): number {
	let missing = 0;

	for (let index = 0; index < TARGET; index++) {
		if (!existing.has(naturalKey(index))) {
			missing++;
		}
	}

	return missing;
}

if (isDirectRun(import.meta.url)) {
	await runSeedFile(grnSeed);
}
