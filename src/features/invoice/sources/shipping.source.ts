import { lang } from '@/config/message.setup';
import type {
	BillableSource,
	BillableSourceProvider,
} from '@/features/invoice/invoice.hooks';
import type ShippingEntity from '@/features/shipping/shipping.entity';
import { shippingService } from '@/features/shipping/shipping.service';

/**
 * A movement of goods as something an order bills on a document of its own. The fee lives on the
 * `shipping` row, never in the order total, so every priced movement that has not failed is billed
 * once, on one line, at its price less the discount already applied to it.
 *
 * Kept here rather than registered by `shipping`: `invoice` depends on `shipping`, so the provider
 * reads the movement through `shippingService` and `shipping` never learns it is billed.
 *
 * A movement with no order - a relocation between warehouses - bills nothing. The ceiling an
 * operator may edit the line to is that one unit at no more than the movement's fee.
 */
const toSource = (shipping: ShippingEntity): BillableSource | null => {
	if (!shipping.order_id) {
		return null;
	}

	return {
		id: shipping.id,
		order_id: shipping.order_id,
		lines: [
			{
				label: lang(`invoice.label.shipping_${shipping.scope}`),
				quantity: 1,
				unit_price: Number(shipping.price),
				vat_rate: Number(shipping.vat_rate),
				discount_reduction: Number(shipping.discount_reduction),
			},
		],
	};
};

export const shippingBillableSource: BillableSourceProvider = {
	billedOnce: true,

	listBillable: async (orderId: number) =>
		(await shippingService.findBillable({ order_id: orderId }))
			.map(toSource)
			.filter((source) => source !== null),

	findBillable: async (sourceId: number) => {
		const [shipping] = await shippingService.findBillable({
			id: sourceId,
		});

		return shipping ? toSource(shipping) : null;
	},

	getLineCaps: async (sourceIds: readonly number[]) => {
		const prices = await shippingService.getPrices(sourceIds);

		return new Map(
			[...prices].map(([id, price]) => [
				id,
				{ max_quantity: 1, max_unit_price: price },
			]),
		);
	},
};
