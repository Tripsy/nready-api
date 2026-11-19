import type { OrderReturnWithLines } from '@/features/order-return/order-return.service';
import { formatDate } from '@/helpers/date.helper';
import { loadEmailTemplate, queueEmail } from '@/providers/email.provider';

/** The three moments the buyer hears about: each has a template of its own. */
export const OrderReturnEmailEventEnum = {
	APPROVED: 'approved',
	REJECTED: 'rejected',
	RECEIVED: 'received',
} as const;

export type OrderReturnEmailEvent =
	(typeof OrderReturnEmailEventEnum)[keyof typeof OrderReturnEmailEventEnum];

/** Who a return's email goes to, resolved by `OrderReturnService` from the order's client. */
export type OrderReturnRecipient = {
	name: string;
	address: string;
	language: string;
};

const TEMPLATES: Record<OrderReturnEmailEvent, string> = {
	[OrderReturnEmailEventEnum.APPROVED]: 'order-return-approved',
	[OrderReturnEmailEventEnum.REJECTED]: 'order-return-rejected',
	[OrderReturnEmailEventEnum.RECEIVED]: 'order-return-received',
};

function reference(code: string | undefined, number: number | undefined) {
	return code && number ? `${code}-${number}` : '';
}

export class OrderReturnEmailService {
	/**
	 * One email per decision or arrival, to the buyer of the order the return was raised against.
	 * The order is linked by id - the storefront's order page is where the buyer follows the
	 * return - so the email carries no state that can go stale beyond what it announces.
	 *
	 * The response travels as written: it is the operator's message to the buyer, the reason a
	 * rejection email is worth sending at all.
	 */
	public async send(
		event: OrderReturnEmailEvent,
		entry: OrderReturnWithLines,
		recipient: OrderReturnRecipient,
	): Promise<void> {
		const emailTemplate = await loadEmailTemplate(
			TEMPLATES[event],
			recipient.language,
		);

		emailTemplate.content.vars = {
			name: recipient.name,
			reference: reference(entry.ref_code, entry.ref_number),
			order_id: entry.order_id,
			order_reference: reference(
				entry.order?.ref_code,
				entry.order?.ref_number,
			),
			response: entry.response ?? '',
			tracking_number: entry.shipping?.tracking_number ?? '',
			tracking_url: entry.shipping?.tracking_url ?? '',
			received_at: entry.received_at
				? (formatDate(entry.received_at, 'date-time') as string)
				: '',
			lines: entry.lines.map((line) => ({
				label: line.label ?? line.sku ?? `#${line.variant_id}`,
				quantity: Number(line.quantity),
			})),
		};

		await queueEmail(emailTemplate, {
			name: recipient.name,
			address: recipient.address,
		});
	}
}

export const orderReturnEmailService = new OrderReturnEmailService();
