import { registerWarehouseAvailabilityResolver } from '@/features/cart/cart.hooks';
import {
	registerLotMovementFinder,
	registerReceiptRecorder,
	registerReceiptReverser,
} from '@/features/grn/grn.hooks';
import {
	registerOrderStockReleaser,
	registerOrderStockReserver,
} from '@/features/order/order.hooks';
import {
	registerReturnedStockReceiver,
	registerReturnedStockRestorer,
	registerShippedStockMover,
} from '@/features/shipping/shipping.hooks';
import { stockReservationService } from '@/features/warehouse-movement/stock-reservation.service';
import { warehouseMovementService } from '@/features/warehouse-movement/warehouse-movement.service';
import { registerStockAvailabilityResolver } from '@/shared/registries/stock-availability.registry';

/**
 * Keeps stock: answers the slots `grn` raises while a receipt is confirmed or canceled (the
 * ledger), the ones `order` raises while an order is placed, re-lined, canceled or completed (the
 * reservations), the ones `shipping` raises as a delivery ships or comes back (both), the one
 * `cart` asks while splitting a checkout across warehouses (availability per site), and the shared
 * availability registry `cart` asks while pricing a basket and `product` while telling a visitor
 * whether a variant is in stock. None of them imports this feature - it depends on the first four,
 * and the registry lives in `shared/registries/`.
 *
 * Without this feature nothing is registered: receipts open and close their lots with no audit
 * trail, orders are placed with no stock check, and deliveries ship drawing nothing. See
 * `grn.hooks.ts`, `order.hooks.ts` and `shipping.hooks.ts` for why each runs inside the caller's
 * transaction.
 */
export default function registerWarehouseMovementBootstrap() {
	registerReceiptRecorder((manager, receipts) =>
		warehouseMovementService.recordReceipts(manager, receipts),
	);

	registerLotMovementFinder((manager, grnItemIds) =>
		warehouseMovementService.findLotMovement(manager, grnItemIds),
	);

	registerReceiptReverser((manager, grnItemIds, occurredAt) =>
		warehouseMovementService.reverseReceipts(
			manager,
			grnItemIds,
			occurredAt,
		),
	);

	registerOrderStockReserver((manager, orderId, demands) =>
		stockReservationService.reserveForOrder(manager, orderId, demands),
	);

	registerOrderStockReleaser((manager, orderId) =>
		stockReservationService.releaseForOrder(manager, orderId),
	);

	registerShippedStockMover((manager, move) =>
		warehouseMovementService.shipDelivery(manager, move),
	);

	registerReturnedStockRestorer((manager, move) =>
		warehouseMovementService.returnDelivery(manager, move),
	);

	registerReturnedStockReceiver((manager, move) =>
		warehouseMovementService.receiveReturn(manager, move),
	);

	registerStockAvailabilityResolver((variantIds) =>
		stockReservationService.getAvailability(variantIds),
	);

	registerWarehouseAvailabilityResolver((manager, variantIds) =>
		stockReservationService.getWarehouseAvailability(manager, variantIds),
	);
}
