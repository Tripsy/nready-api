import { type EntityManager, In, Not } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { Configuration } from '@/config/settings.config';
import { BadRequestError, CustomError, NotFoundError } from '@/exceptions';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import {
	type DocumentSeriesService,
	documentSeriesService,
} from '@/features/document-series/document-series.service';
import { resolveBaseCurrency } from '@/features/exchange-rate/exchange-rate.entity';
import {
	type ExchangeRateService,
	exchangeRateService,
} from '@/features/exchange-rate/exchange-rate.service';
import GrnEntity, {
	type GrnStatus,
	GrnStatusEnum,
	STATUS_TRANSITIONS,
} from '@/features/grn/grn.entity';
import { getGrnRepository } from '@/features/grn/grn.repository';
import type { GrnValidator } from '@/features/grn/grn.validator';
import GrnItemEntity from '@/features/grn/grn-item.entity';
import WarehouseMovementEntity, {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/grn/warehouse-movement.entity';
import ProductEntity from '@/features/product/product.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import {
	type VendorService,
	vendorService,
} from '@/features/vendor/vendor.service';
import {
	type WarehouseService,
	warehouseService,
} from '@/features/warehouse/warehouse.service';
import { formatDate } from '@/helpers/date.helper';
import { roundMoney } from '@/helpers/shop.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

const ENTRY_COLUMNS = [
	'grn.id',
	'grn.ref_code',
	'grn.ref_number',
	'grn.supplier_document_number',
	'grn.status',
	'grn.received_at',
	'grn.confirmed_at',
	'grn.currency',
	'grn.exchange_rate',
	'grn.notes',
	'grn.warehouse_id',
	'grn.vendor_id',
	'grn.created_at',
	'grn.updated_at',
	'grn.deleted_at',
];

const WAREHOUSE_COLUMNS = ['warehouse.id', 'warehouse.code', 'warehouse.name'];

const VENDOR_COLUMNS = ['vendor.id', 'vendor.name'];

/**
 * What a receipt that is no longer a draft still lets an operator correct: the text around the
 * document, never anything stock or cost was computed from. The warehouse, the vendor's goods,
 * the receiving day (it orders the FIFO pick), the currency and rate (frozen into `unit_cost_base`)
 * and the lines themselves are all history once the lots opened.
 */
const POST_DRAFT_EDITABLE = ['supplier_document_number', 'notes'] as const;

type GrnItemPayload = NonNullable<
	ValidatorOutput<GrnValidator, 'create'>['items']
>;

/** A line as `read` hands it over, with what a reader needs to recognize the goods. */
export type GrnItemWithLabel = GrnItemEntity & {
	sku: string | null;
	label: string | null;
};

export type GrnWithItems = GrnEntity & { items: GrnItemWithLabel[] };

/** What a confirm or cancel touched, for the caller to drop the caches of once it commits. */
type StockChange = { productIds: number[] };

/**
 * Converts a unit cost into the base currency at the receipt's frozen rate. Four decimals - the
 * scale of `grn_item.unit_cost_base`, kept wider than money because every FIFO valuation
 * multiplies it.
 */
function toBaseCost(unitCost: number, exchangeRate: number): number {
	return Math.round(unitCost * exchangeRate * 10_000) / 10_000;
}

/**
 * Goods received notes - the only way stock enters a warehouse.
 *
 * **A draft has changed nothing**, so it is edited freely, lines included. **Confirming** is the
 * one moment stock moves: each line's lot opens (`qty_remaining = qty`), a `receipt` movement is
 * posted per line, and `product_variant.cost_price` is re-averaged. **Canceling** a confirmed
 * receipt posts the reversals and closes the lots - and is refused once any lot has been drawn
 * from, since the goods it would take back are no longer all there.
 *
 * Both moves run against a row lock on the receipt and on every variant they re-average, so two
 * confirmations racing for the same variant serialize instead of averaging against a stale
 * on-hand figure.
 */
export class GrnService {
	constructor(
		private repository: ReturnType<typeof getGrnRepository>,
		private documentSeriesService: DocumentSeriesService,
		private exchangeRateService: ExchangeRateService,
		private warehouseService: WarehouseService,
		private vendorService: VendorService,
	) {}

	/**
	 * Resolves the warehouse and the vendor, so a bad id answers with the owning feature's 404
	 * rather than the masked 500 the foreign key would raise. Deleted rows are refused - goods are
	 * not received into, or from, something somebody removed.
	 */
	private async checkReferences(data: {
		warehouse_id?: number;
		vendor_id?: number;
	}): Promise<void> {
		if (data.warehouse_id) {
			await this.warehouseService.findById(data.warehouse_id, false);
		}

		if (data.vendor_id) {
			await this.vendorService.findById(data.vendor_id, false);
		}
	}

	/**
	 * Proves every line names a live variant whose stock is tracked, in one query for the whole
	 * set. Both answer 422 naming the variant: the operator fixes the line, not the request.
	 *
	 * `track_stock` is enforced here rather than at confirmation alone: a draft is the place the
	 * mistake is cheap to correct, and a lot opened for an untracked variant is stock nothing will
	 * ever draw down.
	 */
	private async checkVariants(
		manager: EntityManager,
		items: readonly { variant_id: number }[],
	): Promise<void> {
		if (items.length === 0) {
			return;
		}

		const variantIds = [...new Set(items.map((item) => item.variant_id))];

		const variants = await manager
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true, track_stock: true },
				where: { id: In(variantIds) },
			});

		const byId = new Map(variants.map((variant) => [variant.id, variant]));

		for (const variantId of variantIds) {
			const variant = byId.get(variantId);

			if (!variant) {
				throw new CustomError(
					422,
					lang('grn.error.variant_not_found', {
						variant_id: String(variantId),
					}),
				);
			}

			if (!variant.track_stock) {
				throw new CustomError(
					422,
					lang('grn.error.variant_untracked', {
						variant_id: String(variantId),
					}),
				);
			}
		}
	}

	/**
	 * The rate the receipt's costs convert into base currency at.
	 *
	 * - The base currency is always 1, whatever was stated - anything else would scale every cost.
	 * - A stated rate is taken as is: it is the one the supplier's invoice was converted at.
	 * - Otherwise the published rate of the receiving day. None published is a 400 the operator
	 *   answers by stating one - converting at a made-up rate is worse than refusing.
	 */
	private async resolveExchangeRate(
		currency: string,
		receivedAt: Date,
		stated?: number,
	): Promise<number> {
		if (currency === resolveBaseCurrency()) {
			return 1;
		}

		if (stated !== undefined) {
			return stated;
		}

		const rate = await this.exchangeRateService.getRateAsOf(
			currency,
			receivedAt,
		);

		if (rate === null) {
			throw new BadRequestError(
				lang('grn.error.exchange_rate_unavailable', {
					currency: currency,
				}),
			);
		}

		return rate;
	}

	/**
	 * Replaces a draft's lines with the set the caller sent.
	 *
	 * Removed outright rather than soft-deleted: a draft line is a statement still being written,
	 * no movement points at it yet, and a superseded one kept behind would sit inside the partial
	 * unique index's blind spot for nothing.
	 */
	private async writeItems(
		manager: EntityManager,
		grnId: number,
		items: GrnItemPayload,
		exchangeRate: number,
	): Promise<void> {
		await manager.getRepository(GrnItemEntity).delete({ grn_id: grnId });

		if (items.length === 0) {
			return;
		}

		await manager.save(
			items.map((item) =>
				manager.create(GrnItemEntity, {
					grn_id: grnId,
					variant_id: item.variant_id,
					qty: item.qty,
					// Opens on confirmation, never at insert - see the column's comment
					qty_remaining: 0,
					unit_cost: item.unit_cost,
					unit_cost_base: toBaseCost(item.unit_cost, exchangeRate),
					vat_rate: item.vat_rate ?? 0,
					lot_code: item.lot_code || null,
					expires_at: item.expires_at
						? formatDate(item.expires_at, 'default')
						: null,
					notes: item.notes || null,
				}),
			),
		);
	}

	/**
	 * @description Used in `create` method from controller;
	 *
	 * A receipt starts as a draft. Its number is allocated now, in the same transaction as the
	 * insert, so a draft later canceled keeps its number like any other document - the series
	 * stays continuous.
	 */
	public async create(
		data: ValidatorOutput<GrnValidator, 'create'>,
	): Promise<GrnEntity> {
		await this.checkReferences(data);

		const exchangeRate = await this.resolveExchangeRate(
			data.currency,
			data.received_at,
			data.exchange_rate,
		);

		return dataSource.transaction((manager) =>
			this.createWithin(manager, {
				...data,
				exchange_rate: exchangeRate,
			}),
		);
	}

	/**
	 * Writes a draft and its lines inside a transaction the caller holds. Public for the demo seed,
	 * which writes receipts in its own transaction; the references and the rate are the caller's
	 * to have resolved.
	 */
	public async createWithin(
		manager: EntityManager,
		data: ValidatorOutput<GrnValidator, 'create'> & {
			exchange_rate: number;
		},
	): Promise<GrnEntity> {
		await this.checkVariants(manager, data.items ?? []);

		const reference = await this.documentSeriesService.allocate(
			manager,
			DocumentTypeEnum.GRN,
		);

		const entry = await manager.save(
			manager.create(GrnEntity, {
				ref_code: reference.code,
				ref_number: reference.number,
				supplier_document_number: data.supplier_document_number || null,
				status: GrnStatusEnum.DRAFT,
				received_at: data.received_at,
				currency: data.currency,
				exchange_rate: data.exchange_rate,
				notes: data.notes || null,
				warehouse_id: data.warehouse_id,
				vendor_id: data.vendor_id,
			}),
		);

		await this.writeItems(
			manager,
			entry.id,
			data.items ?? [],
			data.exchange_rate,
		);

		return entry;
	}

	/**
	 * Locks the receipt for the rest of the caller's transaction and returns it as it stands
	 * there - the status the caller acts on must be the committed one, not the one read before
	 * the transaction opened.
	 */
	private async lockEntry(
		manager: EntityManager,
		id: number,
	): Promise<GrnEntity> {
		const entry = await manager.getRepository(GrnEntity).findOne({
			where: { id: id },
			lock: { mode: 'pessimistic_write' },
		});

		if (!entry) {
			throw new NotFoundError(lang('grn.error.not_found'));
		}

		return entry;
	}

	/**
	 * @description Used in `update` method from controller
	 *
	 * **A draft takes any change.** A rate is re-resolved whenever the currency or the receiving
	 * day changes, unless the request states one, and every line's `unit_cost_base` is rewritten
	 * at it - whether or not the lines themselves were sent.
	 *
	 * **A confirmed receipt takes only `POST_DRAFT_EDITABLE`**; anything else answers 409 rather
	 * than being dropped, because the operator asked for a change that would silently not happen.
	 * A canceled receipt takes nothing.
	 */
	public async updateData(
		entry: GrnEntity,
		data: ValidatorOutput<GrnValidator, 'update'>,
	): Promise<GrnEntity> {
		if (entry.status === GrnStatusEnum.CANCELED) {
			throw new CustomError(409, lang('grn.error.canceled_locked'));
		}

		const { id: _id, ...changes } = data;

		if (entry.status === GrnStatusEnum.CONFIRMED) {
			const locked = Object.entries(changes).some(
				([key, value]) =>
					value !== undefined &&
					!(POST_DRAFT_EDITABLE as readonly string[]).includes(key),
			);

			if (locked) {
				throw new CustomError(409, lang('grn.error.confirmed_locked'));
			}
		}

		await this.checkReferences(data);

		const currency = data.currency ?? entry.currency;
		const receivedAt = data.received_at ?? entry.received_at;
		const rateMoves =
			data.currency !== undefined ||
			data.received_at !== undefined ||
			data.exchange_rate !== undefined;

		const exchangeRate = rateMoves
			? await this.resolveExchangeRate(
					currency,
					receivedAt,
					data.exchange_rate,
				)
			: entry.exchange_rate;

		const saved = await dataSource.transaction(async (manager) => {
			const current = await this.lockEntry(manager, entry.id);

			// Confirmed or canceled between the read and the lock: judge it again as it now stands
			if (current.status !== entry.status) {
				throw new CustomError(409, lang('grn.error.status_changed'));
			}

			if (data.items) {
				await this.checkVariants(manager, data.items);
			}

			Object.assign(current, {
				...(data.warehouse_id !== undefined && {
					warehouse_id: data.warehouse_id,
				}),
				...(data.vendor_id !== undefined && {
					vendor_id: data.vendor_id,
				}),
				...(data.supplier_document_number !== undefined && {
					supplier_document_number:
						data.supplier_document_number || null,
				}),
				...(data.notes !== undefined && { notes: data.notes || null }),
				received_at: receivedAt,
				currency: currency,
				exchange_rate: exchangeRate,
			});

			const grn = await manager.save(current);

			if (data.items) {
				await this.writeItems(
					manager,
					grn.id,
					data.items,
					exchangeRate,
				);
			} else if (rateMoves) {
				await manager
					.createQueryBuilder()
					.update(GrnItemEntity)
					.set({
						unit_cost_base: () => 'ROUND(unit_cost * :rate, 4)',
					})
					.setParameter('rate', exchangeRate)
					.where('grn_id = :grnId', { grnId: grn.id })
					.execute();
			}

			return grn;
		});

		await cleanEntityCache(GrnEntity, saved.id);

		return saved;
	}

	/**
	 * Moves a receipt along `STATUS_TRANSITIONS` - a repeat of the current status answers 400, an
	 * illegal move 409. The move itself runs under the receipt's row lock, so two operators
	 * confirming the same draft cannot both post its movements.
	 *
	 * Confirming and canceling re-average `cost_price`, which the product reads carry, so the
	 * caches of every product touched are dropped once the transaction commits.
	 */
	public async updateStatus(
		entry: GrnEntity,
		newStatus: GrnStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		const change = await dataSource.transaction((manager) =>
			newStatus === GrnStatusEnum.CONFIRMED
				? this.confirmWithin(manager, entry.id)
				: this.cancelWithin(manager, entry.id),
		);

		await cleanEntityCache(GrnEntity, entry.id);
		await cleanEntityCacheMany(ProductEntity, change.productIds);
	}

	/**
	 * Locks the variants a receipt's lines name, in id order so two transactions over overlapping
	 * sets take their locks in the same sequence, and reads what a re-average needs.
	 *
	 * Deleted variants are included: a confirmed lot of a variant removed since must still be
	 * reversible, and the delete is `RESTRICT`ed by the lot anyway.
	 */
	private async lockVariants(
		manager: EntityManager,
		variantIds: number[],
	): Promise<Map<number, ProductVariantEntity>> {
		const variants = await manager
			.getRepository(ProductVariantEntity)
			.find({
				select: {
					id: true,
					product_id: true,
					track_stock: true,
					cost_price: true,
					deleted_at: true,
				},
				where: { id: In(variantIds) },
				order: { id: 'ASC' },
				withDeleted: true,
				lock: { mode: 'pessimistic_write' },
			});

		return new Map(variants.map((variant) => [variant.id, variant]));
	}

	/**
	 * Units on hand per variant, across **every** warehouse: `cost_price` is one figure per
	 * variant, so the average it is part of has to weigh the stock of every site, not the one
	 * receiving. Open lots on confirmed, live receipts - `IDX_grn_item_variant_open` serves the
	 * lot side.
	 */
	private async onHandByVariant(
		manager: EntityManager,
		variantIds: number[],
	): Promise<Map<number, number>> {
		const rows = await manager
			.getRepository(GrnItemEntity)
			.createQueryBuilder('item')
			.innerJoin(
				GrnEntity,
				'grn',
				'grn.id = item.grn_id AND grn.deleted_at IS NULL',
			)
			.select('item.variant_id', 'variant_id')
			.addSelect('SUM(item.qty_remaining)', 'on_hand')
			.where('item.variant_id IN (:...variantIds)', {
				variantIds: variantIds,
			})
			.andWhere('item.qty_remaining > 0')
			.andWhere('grn.status = :status', {
				status: GrnStatusEnum.CONFIRMED,
			})
			.groupBy('item.variant_id')
			.getRawMany<{ variant_id: number; on_hand: string }>();

		return new Map(
			rows.map((row) => [Number(row.variant_id), Number(row.on_hand)]),
		);
	}

	/**
	 * Confirms a draft inside the caller's transaction. Public for the demo seed, which confirms
	 * the receipts it writes through exactly this path.
	 *
	 * Per line: the lot opens, a `receipt` movement is posted at the lot's base cost and the
	 * receiving day, and the variant's `cost_price` becomes the weighted moving average
	 * `(on_hand × cost_price + qty × unit_cost_base) / (on_hand + qty)`. A variant with no cost yet,
	 * or nothing on hand, simply takes the lot's cost. Rounded to the cent, the column's scale.
	 */
	public async confirmWithin(
		manager: EntityManager,
		id: number,
	): Promise<StockChange> {
		const entry = await this.lockEntry(manager, id);

		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			GrnStatusEnum.CONFIRMED,
		);

		const items = await manager.getRepository(GrnItemEntity).find({
			where: { grn_id: entry.id },
			order: { id: 'ASC' },
		});

		if (items.length === 0) {
			throw new CustomError(409, lang('grn.error.no_items'));
		}

		const variantIds = items.map((item) => item.variant_id);
		const variants = await this.lockVariants(manager, variantIds);
		const onHand = await this.onHandByVariant(manager, variantIds);

		for (const item of items) {
			const variant = variants.get(item.variant_id);

			// Re-checked here: the variant may have changed since the draft was written
			if (!variant || variant.deleted_at) {
				throw new CustomError(
					409,
					lang('grn.error.variant_not_found', {
						variant_id: String(item.variant_id),
					}),
				);
			}

			if (!variant.track_stock) {
				throw new CustomError(
					409,
					lang('grn.error.variant_untracked', {
						variant_id: String(item.variant_id),
					}),
				);
			}

			const held = onHand.get(item.variant_id) ?? 0;
			const currentCost = variant.cost_price;

			variant.cost_price =
				currentCost === null || held <= 0
					? roundMoney(item.unit_cost_base)
					: roundMoney(
							(held * Number(currentCost) +
								item.qty * item.unit_cost_base) /
								(held + item.qty),
						);
		}

		await manager
			.createQueryBuilder()
			.update(GrnItemEntity)
			.set({ qty_remaining: () => 'qty' })
			.where('grn_id = :grnId', { grnId: entry.id })
			.execute();

		await manager.save(
			items.map((item) =>
				manager.create(WarehouseMovementEntity, {
					movement_type: WarehouseMovementTypeEnum.RECEIPT,
					qty: item.qty,
					unit_cost_base: item.unit_cost_base,
					source_type: WarehouseMovementSourceEnum.GRN_ITEM,
					source_id: item.id,
					occurred_at: entry.received_at,
					warehouse_id: entry.warehouse_id,
					variant_id: item.variant_id,
					grn_item_id: item.id,
					reversal_of_id: null,
					notes: null,
				}),
			),
		);

		await this.saveCosts(manager, [...variants.values()]);

		entry.status = GrnStatusEnum.CONFIRMED;
		entry.confirmed_at = new Date();

		await manager.save(entry);

		return {
			productIds: [
				...new Set(
					[...variants.values()].map((variant) => variant.product_id),
				),
			],
		};
	}

	/**
	 * Cancels a receipt inside the caller's transaction.
	 *
	 * A draft simply moves to `canceled` - it changed nothing. A confirmed receipt is taken back:
	 *
	 * - **Refused once any lot has been drawn from.** Those units were sold, written off or moved,
	 *   and the cost of goods already reported for them came from this lot. Undoing it is a return
	 *   or an adjustment, not a cancellation. Two checks hold this: `qty_remaining` below `qty`,
	 *   and any ledger row on the lot besides its own receipt - a sale answered by a return nets
	 *   `qty_remaining` back to `qty`, yet its cost was reported against this lot all the same.
	 * - Each `receipt` movement is answered by an opposing row with `reversal_of_id` set. It is an
	 *   `adjustment`, the one movement type the ledger's direction CHECK lets carry a negative
	 *   quantity for a correction; `IDX_warehouse_movement_reversal_of_id` stops a second reversal.
	 * - `cost_price` is taken back out of the average:
	 *   `(on_hand × cost_price - qty × unit_cost_base) / (on_hand - qty)`. Left as it is when no
	 *   stock remains, or when the result would go negative - an average already moved by later
	 *   receipts cannot always be unwound exactly, and the last known cost is the better answer.
	 */
	public async cancelWithin(
		manager: EntityManager,
		id: number,
	): Promise<StockChange> {
		const entry = await this.lockEntry(manager, id);

		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			GrnStatusEnum.CANCELED,
		);

		if (entry.status === GrnStatusEnum.DRAFT) {
			entry.status = GrnStatusEnum.CANCELED;

			await manager.save(entry);

			return { productIds: [] };
		}

		const items = await manager.getRepository(GrnItemEntity).find({
			where: { grn_id: entry.id },
			order: { id: 'ASC' },
			lock: { mode: 'pessimistic_write' },
		});

		const consumed = items.find((item) => item.qty_remaining !== item.qty);

		if (consumed) {
			throw new CustomError(
				409,
				lang('grn.error.lot_consumed', {
					variant_id: String(consumed.variant_id),
					remaining: String(consumed.qty_remaining),
					qty: String(consumed.qty),
				}),
			);
		}

		// `qty_remaining` is a net figure - a sale answered by a return brings it back to `qty`.
		// The ledger is what says the lot moved: any row on it besides its own receipt.
		const moved = await manager
			.getRepository(WarehouseMovementEntity)
			.findOne({
				where: {
					grn_item_id: In(items.map((item) => item.id)),
					movement_type: Not(WarehouseMovementTypeEnum.RECEIPT),
				},
				order: { id: 'ASC' },
			});

		if (moved) {
			const item = items.find((row) => row.id === moved.grn_item_id);

			throw new CustomError(
				409,
				lang('grn.error.lot_moved', {
					variant_id: String(item?.variant_id ?? moved.variant_id),
					movement_type: moved.movement_type,
				}),
			);
		}

		const receipts = await manager
			.getRepository(WarehouseMovementEntity)
			.find({
				where: {
					grn_item_id: In(items.map((item) => item.id)),
					movement_type: WarehouseMovementTypeEnum.RECEIPT,
				},
				order: { id: 'ASC' },
			});

		const variantIds = items.map((item) => item.variant_id);
		const variants = await this.lockVariants(manager, variantIds);
		const onHand = await this.onHandByVariant(manager, variantIds);

		for (const item of items) {
			const variant = variants.get(item.variant_id);

			if (!variant || variant.cost_price === null) {
				continue;
			}

			const held = onHand.get(item.variant_id) ?? 0;
			const remaining = held - item.qty;

			if (remaining <= 0) {
				continue;
			}

			const unwound =
				(held * Number(variant.cost_price) -
					item.qty * item.unit_cost_base) /
				remaining;

			if (unwound >= 0) {
				variant.cost_price = roundMoney(unwound);
			}
		}

		const now = new Date();

		await manager.save(
			receipts.map((receipt) =>
				manager.create(WarehouseMovementEntity, {
					movement_type: WarehouseMovementTypeEnum.ADJUSTMENT,
					qty: -receipt.qty,
					unit_cost_base: receipt.unit_cost_base,
					source_type: receipt.source_type,
					source_id: receipt.source_id,
					occurred_at: now,
					warehouse_id: receipt.warehouse_id,
					variant_id: receipt.variant_id,
					grn_item_id: receipt.grn_item_id,
					reversal_of_id: receipt.id,
					// `reversal_of_id` is what says this row cancels another; no prose is stored beside it
					notes: null,
				}),
			),
		);

		await manager
			.createQueryBuilder()
			.update(GrnItemEntity)
			.set({ qty_remaining: 0 })
			.where('grn_id = :grnId', { grnId: entry.id })
			.execute();

		await this.saveCosts(manager, [...variants.values()]);

		entry.status = GrnStatusEnum.CANCELED;

		await manager.save(entry);

		return {
			productIds: [
				...new Set(
					[...variants.values()].map((variant) => variant.product_id),
				),
			],
		};
	}

	/** One UPDATE per variant - a receipt names each variant once, so this is one per line. */
	private async saveCosts(
		manager: EntityManager,
		variants: ProductVariantEntity[],
	): Promise<void> {
		for (const variant of variants) {
			await manager.update(
				ProductVariantEntity,
				{ id: variant.id },
				{ cost_price: variant.cost_price },
			);
		}
	}

	/**
	 * Soft delete, for a draft or a canceled receipt only. A confirmed one holds open lots, and
	 * deleting it would drop them out of every on-hand figure while its movements stayed in the
	 * ledger - a drift the reconciliation could only report. It is canceled instead.
	 */
	public async delete(id: number): Promise<void> {
		const entry = await this.findById(id, false);

		if (entry.status === GrnStatusEnum.CONFIRMED) {
			throw new CustomError(409, lang('grn.error.delete_confirmed'));
		}

		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number): Promise<void> {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<GrnEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * A receipt's lines in the order they were written, each with the variant's SKU and the
	 * product's name. Looked up in one batched read each rather than joined, so a variant or a
	 * translation removed since still names what was received - a join would blank it. The name
	 * is in the default content language, since the `read` payload is cached per id alone.
	 */
	public async getItems(grnId: number): Promise<GrnItemWithLabel[]> {
		const items = await dataSource.getRepository(GrnItemEntity).find({
			where: { grn_id: grnId },
			order: { id: 'ASC' },
		});

		if (items.length === 0) {
			return [];
		}

		const variants = await dataSource
			.getRepository(ProductVariantEntity)
			.find({
				select: { id: true, sku: true, product_id: true },
				where: {
					id: In([...new Set(items.map((item) => item.variant_id))]),
				},
				withDeleted: true,
			});

		const contents = await dataSource
			.getRepository(ProductContentEntity)
			.find({
				select: { product_id: true, label: true },
				where: {
					product_id: In([
						...new Set(
							variants.map((variant) => variant.product_id),
						),
					]),
					language: Configuration.language(),
				},
				withDeleted: true,
			});

		const variantById = new Map(
			variants.map((variant) => [variant.id, variant]),
		);
		const labelByProduct = new Map(
			contents.map((content) => [content.product_id, content.label]),
		);

		return items.map((item) => {
			const variant = variantById.get(item.variant_id);

			return Object.assign(item, {
				sku: variant?.sku ?? null,
				label: variant
					? (labelByProduct.get(variant.product_id) ?? null)
					: null,
			});
		});
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: {
		id: number;
		withDeleted: boolean;
	}): Promise<GrnWithItems> {
		const entry = await this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...WAREHOUSE_COLUMNS, ...VENDOR_COLUMNS])
			.join('grn.warehouse', 'warehouse', 'LEFT')
			.join('grn.vendor', 'vendor', 'LEFT')
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();

		return Object.assign(entry, { items: await this.getItems(entry.id) });
	}

	public findByFilter(
		data: ValidatorOutput<GrnValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...WAREHOUSE_COLUMNS, ...VENDOR_COLUMNS])
			.join('grn.warehouse', 'warehouse', 'LEFT')
			.join('grn.vendor', 'vendor', 'LEFT')
			.filterById(data.filter.id)
			.filterBy('warehouse_id', data.filter.warehouse_id)
			.filterBy('vendor_id', data.filter.vendor_id)
			.filterBy('status', data.filter.status)
			.filterByRange(
				'received_at',
				data.filter.received_at_start,
				data.filter.received_at_end,
			)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const grnService = new GrnService(
	getGrnRepository(),
	documentSeriesService,
	exchangeRateService,
	warehouseService,
	vendorService,
);
