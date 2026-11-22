import type { EntityManager } from 'typeorm';
import {
	isDirectRun,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import { DocumentTypeEnum } from '@/features/document-series/document-series.entity';
import { documentSeriesService } from '@/features/document-series/document-series.service';
import OrderLineEntity from '@/features/order/order-line.entity';
import OrderReturnEntity, {
	type OrderReturnReason,
	OrderReturnReasonEnum,
	type OrderReturnStatus,
	OrderReturnStatusEnum,
} from '@/features/order-return/order-return.entity';
import OrderReturnLineEntity from '@/features/order-return/order-return-line.entity';
import ShippingEntity, {
	ShippingMethodEnum,
	ShippingScopeEnum,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import { shippingService } from '@/features/shipping/shipping.service';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';
import type { EntityId } from '@/shared/types/entity-id.type';

const TARGET = 8;

const NOTES_PREFIX = 'DEMO-RMA-';

const naturalKey = (index: number): string =>
	`${NOTES_PREFIX}${sequenceLabel(index)}`;

/**
 * Cycled by index, so every state a dashboard filter offers has rows. `received` and `closed` are
 * absent on purpose: they mean stock came back and a refund was drafted, which only the movement
 * arriving produces - a seed writing them by hand would leave the ledger disagreeing with them.
 */
const STATUS_CYCLE: readonly OrderReturnStatus[] = [
	OrderReturnStatusEnum.REQUESTED,
	OrderReturnStatusEnum.APPROVED,
	OrderReturnStatusEnum.REJECTED,
	OrderReturnStatusEnum.CANCELED,
];

const CUSTOMER_NOTES: Record<OrderReturnReason, string> = {
	damaged: 'The box was crushed and the item is cracked',
	defective: 'Stopped working after two days',
	wrong_item: 'Ordered M, received L',
	not_as_described: 'The color is quite different from the photos',
	no_longer_needed: 'Bought a second one by mistake',
	other: 'Please call me to arrange the pickup',
};

/**
 * Demo return authorizations against orders whose deliveries arrived.
 *
 * Each asks back one unit of one delivered variant, within what is still returnable - read through
 * `ShippingService.getReturnableByVariant` in the seed's own transaction, so a re-run never claims
 * goods an earlier return holds. An `approved` one gets its `return` movement through
 * `ShippingService.createWithin`, `pending`, from the address the delivery went to, free to the
 * buyer - the same row an operator's approval writes.
 *
 * The natural key is the internal `notes` (`DEMO-RMA-0001`): written only for a key not stored
 * yet. Orders with nothing delivered produce no candidates, so on a database where no delivery has
 * arrived the seed inserts nothing.
 */
export const orderReturnSeed: SeedDefinition = {
	name: 'order-return',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(OrderReturnEntity);

		const existing = new Set(
			(
				await repository.find({
					select: { notes: true },
					withDeleted: true,
				})
			).map((entry) => entry.notes),
		);

		const deliveries = await manager.getRepository(ShippingEntity).find({
			select: {
				id: true,
				order_id: true,
				destination_client_address_id: true,
				currency: true,
			},
			where: {
				scope: ShippingScopeEnum.DELIVERY,
				status: ShippingStatusEnum.DELIVERED,
			},
			order: { id: 'ASC' },
		});

		const warehouses = await manager.getRepository(WarehouseEntity).find({
			select: { id: true },
			where: { status: WarehouseStatusEnum.ACTIVE },
			order: { id: 'ASC' },
		});

		let inserted = 0;

		for (let index = 0; index < TARGET; index++) {
			// Drawn before the skip, so the rows stay a pure function of the index across re-runs
			const reason = randomPick(
				random,
				Object.values(OrderReturnReasonEnum),
			);
			const pick = random();

			const key = naturalKey(index);

			if (existing.has(key) || deliveries.length === 0) {
				continue;
			}

			const delivery =
				deliveries[Math.floor(pick * deliveries.length)] ??
				deliveries[0];

			if (!delivery.order_id) {
				continue;
			}

			const line = await firstReturnable(manager, delivery.order_id);

			if (!line) {
				continue;
			}

			const status = STATUS_CYCLE[index % STATUS_CYCLE.length];
			const reference = await documentSeriesService.allocate(
				manager,
				DocumentTypeEnum.ORDER_RETURN,
			);

			let shippingId: EntityId | null = null;

			if (
				status === OrderReturnStatusEnum.APPROVED &&
				delivery.destination_client_address_id &&
				warehouses.length > 0
			) {
				const movement = await shippingService.createWithin(manager, {
					scope: ShippingScopeEnum.RETURN,
					method: ShippingMethodEnum.COURIER,
					order_id: delivery.order_id,
					pickup_client_address_id:
						delivery.destination_client_address_id,
					destination_warehouse_id: warehouses[0].id,
					price: 0,
					vat_rate: 0,
					operational_cost: undefined,
					currency: delivery.currency,
					notes: `Return ${reference.code}-${reference.number}`,
					lines: [
						{ ...line, condition: undefined, notes: undefined },
					],
				});

				shippingId = movement.id;
			}

			const decided =
				status !== OrderReturnStatusEnum.REQUESTED &&
				status !== OrderReturnStatusEnum.CANCELED;

			const entry = await repository.save(
				repository.create({
					ref_code: reference.code,
					ref_number: reference.number,
					// An approval that found no pickup address stays a request
					status:
						status === OrderReturnStatusEnum.APPROVED && !shippingId
							? OrderReturnStatusEnum.REQUESTED
							: status,
					reason: reason,
					customer_notes: CUSTOMER_NOTES[reason],
					response:
						status === OrderReturnStatusEnum.REJECTED
							? 'The return window for this item has passed'
							: status === OrderReturnStatusEnum.APPROVED
								? 'Approved - the courier will collect it'
								: null,
					notes: key,
					decided_at: decided ? new Date() : null,
					reversal_invoice_ids: [],
					order_id: delivery.order_id,
					shipping_id: shippingId,
					user_id: null,
				}),
			);

			await manager.save(
				manager.create(OrderReturnLineEntity, {
					order_return_id: entry.id,
					...line,
				}),
			);

			existing.add(key);
			inserted++;
		}

		const tableTotal = await repository.count({ withDeleted: true });

		return {
			entity: 'order-return',
			alreadyPresent: Math.min(tableTotal - inserted, TARGET),
			inserted: inserted,
			target: TARGET,
			tableTotal: tableTotal,
		};
	},
};

/**
 * One unit of the first variant the order can still send back, less what live returns - movements
 * and pending requests alike - already claim. Null when nothing is left.
 */
async function firstReturnable(
	manager: EntityManager,
	orderId: EntityId,
): Promise<{
	variant_id: EntityId;
	product_id: EntityId;
	quantity: number;
} | null> {
	const returnable = await shippingService.getReturnableByVariant(
		orderId,
		manager,
	);

	const requested = await manager
		.getRepository(OrderReturnLineEntity)
		.createQueryBuilder('line')
		.innerJoin(
			OrderReturnEntity,
			'order_return',
			'order_return.id = line.order_return_id',
		)
		.where('order_return.order_id = :orderId', { orderId: orderId })
		.andWhere('order_return.status = :status', {
			status: OrderReturnStatusEnum.REQUESTED,
		})
		.select('line.variant_id', 'variant_id')
		.addSelect('SUM(line.quantity)', 'quantity')
		.groupBy('line.variant_id')
		.getRawMany<{ variant_id: EntityId; quantity: string }>();

	for (const row of requested) {
		const variantId = row.variant_id;

		returnable.set(
			variantId,
			(returnable.get(variantId) ?? 0) - Number(row.quantity),
		);
	}

	const lines = await manager.getRepository(OrderLineEntity).find({
		select: { variant_id: true, product_id: true },
		where: { order_id: orderId },
		order: { id: 'ASC' },
	});

	for (const line of lines) {
		if ((returnable.get(line.variant_id) ?? 0) >= 1) {
			return {
				variant_id: line.variant_id,
				product_id: line.product_id,
				quantity: 1,
			};
		}
	}

	return null;
}

if (isDirectRun(import.meta.url)) {
	await runSeedFile(orderReturnSeed);
}
