import {
	isDirectRun,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import { addressService } from '@/features/address/address.service';
import CarrierEntity from '@/features/carrier/carrier.entity';
import ClientAddressEntity, {
	ClientAddressTypeEnum,
} from '@/features/client-address/client-address.entity';
import { clientAddressService } from '@/features/client-address/client-address.service';
import OrderEntity, {
	type OrderStatus,
	OrderStatusEnum,
} from '@/features/order/order.entity';
import OrderLineEntity from '@/features/order/order-line.entity';
import ShippingEntity, {
	ShippingMethodEnum,
	ShippingScopeEnum,
	type ShippingStatus,
	ShippingStatusEnum,
} from '@/features/shipping/shipping.entity';
import ShippingLineEntity from '@/features/shipping/shipping-line.entity';
import WarehouseEntity, {
	WarehouseStatusEnum,
} from '@/features/warehouse/warehouse.entity';

const TARGET = 20;

/** Every fourth order leaves in two consignments, from two different sites. */
const SPLIT_EVERY = 4;

/**
 * Where a consignment has got to, derived from the document it belongs to rather than picked at
 * random - a canceled order with a delivered consignment is a shape the application cannot produce.
 */
function shippingStatusFor(orderStatus: OrderStatus): ShippingStatus {
	switch (orderStatus) {
		case OrderStatusEnum.COMPLETED:
			return ShippingStatusEnum.DELIVERED;
		case OrderStatusEnum.CONFIRMED:
			return ShippingStatusEnum.PREPARING;
		case OrderStatusEnum.CANCELLED:
			return ShippingStatusEnum.FAILED;
		default:
			return ShippingStatusEnum.PENDING;
	}
}

/**
 * Demo movements, with what travels in each.
 *
 * **Deliveries only.** A `relocation` answers to a document the system does not have yet, and a
 * `return` only makes sense against goods that were delivered and sent back - neither is a shape
 * demo data can invent honestly, so the seed writes the one scope a checkout also produces.
 *
 * **One order deliberately leaves in two consignments**, from two different warehouses, because
 * that is the case the schema exists for and the one a reader has to see to understand
 * `shipping_line` at all: a single movement per order looks like a column that could have lived on
 * `order`.
 *
 * The natural key is the order: a movement is written only for an order that has none yet, so a
 * re-run tops the table up rather than sending the same goods twice.
 *
 * Both ends of a dispatched row are frozen through the same services the shipped transition uses,
 * so the frozen copies in the demo data are the real thing rather than hand-built objects that
 * could drift from what the application writes.
 */
export const shippingSeed: SeedDefinition = {
	name: 'shipping',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(ShippingEntity);
		const lineRepository = manager.getRepository(ShippingLineEntity);

		const tableTotal = await repository.count({ withDeleted: true });

		const warehouses = await manager.getRepository(WarehouseEntity).find({
			select: { id: true, address_id: true },
			where: { status: WarehouseStatusEnum.ACTIVE },
			order: { id: 'ASC' },
		});

		const carriers = await manager.getRepository(CarrierEntity).find({
			select: { id: true },
			order: { id: 'ASC' },
		});

		/*
		 * Only orders that have no movement yet, so a re-run adds rather than duplicates. The lines
		 * come along because a movement cites the variants on them.
		 */
		const orders = await manager
			.getRepository(OrderEntity)
			.createQueryBuilder('order')
			.leftJoin(
				ShippingEntity,
				'shipping',
				'shipping.order_id = order.id',
			)
			.where('order.deleted_at IS NULL')
			.andWhere('shipping.id IS NULL')
			.select(['order.id AS id', 'order.status AS status'])
			.orderBy('order.id', 'ASC')
			.getRawMany<{ id: number; status: OrderStatus }>();

		if (warehouses.length === 0 || orders.length === 0) {
			return {
				entity: 'shipping',
				alreadyPresent: tableTotal,
				inserted: 0,
				target: 0,
				tableTotal: tableTotal,
			};
		}

		const carrierIds = carriers.map((carrier) => carrier.id);

		const missing = Math.max(0, TARGET - tableTotal);

		let inserted = 0;

		for (const [index, order] of orders.entries()) {
			if (inserted >= missing) {
				break;
			}

			const orderLines = await manager
				.getRepository(OrderLineEntity)
				.find({
					select: {
						id: true,
						variant_id: true,
						product_id: true,
						quantity: true,
						currency: true,
					},
					where: { order_id: Number(order.id) },
					order: { id: 'ASC' },
				});

			if (orderLines.length === 0) {
				continue;
			}

			const client = await manager.getRepository(OrderEntity).findOne({
				select: { id: true, client_id: true },
				where: { id: Number(order.id) },
			});

			const deliveryAddress = client
				? await manager.getRepository(ClientAddressEntity).findOne({
						select: { id: true },
						where: {
							client_id: client.client_id,
							type: ClientAddressTypeEnum.DELIVERY,
						},
					})
				: null;

			const status = shippingStatusFor(order.status);
			const currency = orderLines[0].currency;

			/*
			 * A split needs at least two lines to divide; an order of one travels whole however the
			 * counter falls.
			 */
			const isSplit =
				index % SPLIT_EVERY === 0 &&
				orderLines.length > 1 &&
				warehouses.length > 1;

			const groups = isSplit
				? [
						orderLines.slice(0, Math.ceil(orderLines.length / 2)),
						orderLines.slice(Math.ceil(orderLines.length / 2)),
					]
				: [orderLines];

			for (const [groupIndex, group] of groups.entries()) {
				const method = randomPick(random, [
					ShippingMethodEnum.COURIER,
					ShippingMethodEnum.COURIER,
					ShippingMethodEnum.SELF_PICKUP,
				]);

				/*
				 * A pickup is collected from the warehouse, so it has no destination address - but a
				 * delivery needs one, and the scope's CHECK plus the service both require it. An
				 * order whose client filed no delivery address therefore ships as a pickup.
				 */
				const destinationAddressId =
					method === ShippingMethodEnum.COURIER
						? (deliveryAddress?.id ?? null)
						: null;

				if (!destinationAddressId) {
					continue;
				}

				// Two consignments of one order leave from different sites, which is the whole
				// reason the warehouse sits on the movement rather than on the order
				const warehouse = warehouses[groupIndex % warehouses.length];

				const hasLeft =
					status === ShippingStatusEnum.DELIVERED ||
					status === ShippingStatusEnum.SHIPPED;

				const shipping = await repository.save(
					repository.create({
						scope: ShippingScopeEnum.DELIVERY,
						order_id: Number(order.id),
						pickup_warehouse_id: warehouse.id,
						destination_client_address_id: destinationAddressId,
						pickup_data: hasLeft
							? await addressService.getSnapshotById(
									warehouse.address_id,
								)
							: null,
						destination_data: hasLeft
							? await clientAddressService.getSnapshotById(
									destinationAddressId,
								)
							: null,
						carrier_id:
							carrierIds.length > 0
								? randomPick(random, carrierIds)
								: null,
						status: status,
						method: method,
						tracking_number: hasLeft
							? `TRK${String(randomInt(random, 100000, 999999))}`
							: null,
						price: 0,
						vat_rate: 0,
						currency: currency,
						exchange_rate: 1,
						shipped_at: hasLeft ? new Date() : null,
						delivered_at:
							status === ShippingStatusEnum.DELIVERED
								? new Date()
								: null,
						notes: null,
					}),
				);

				await lineRepository.save(
					group.map((line) =>
						lineRepository.create({
							shipping_id: shipping.id,
							variant_id: line.variant_id,
							product_id: line.product_id,
							quantity: line.quantity,
							notes: null,
						}),
					),
				);

				inserted++;
			}
		}

		return {
			entity: 'shipping',
			alreadyPresent: Math.min(tableTotal, TARGET),
			inserted: inserted,
			target: TARGET,
			tableTotal: tableTotal + inserted,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(shippingSeed);
}
