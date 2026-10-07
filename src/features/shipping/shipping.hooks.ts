import { createNotification } from '@/helpers/hook.helper';

/**
 * What `shipping` announces about its own rows - answered by whichever feature bills orders
 * (`invoice`), which depends on `shipping` and registers from its bootstrap. See
 * `invoice.hooks.ts` for the invoice-first chain this step belongs to.
 */

/**
 * A movement of goods has just been written or moved along. `order_id` is null on a `relocation`,
 * which bills nobody and is announced only so the payload never has to be filtered by the sender.
 */
export type ShippingChangedPayload = {
	shipping_id: number;
	order_id: number | null;
};

const shippingChanged = createNotification<ShippingChangedPayload>(
	'Failed to bill or settle the order behind a shipping change',
);

export const registerShippingChangedHandler = shippingChanged.register;
export const notifyShippingChanged = shippingChanged.notify;
