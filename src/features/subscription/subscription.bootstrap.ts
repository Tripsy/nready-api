import dataSource from '@/config/data-source.config';
import SubscriptionEntity from '@/features/subscription/subscription.entity';
import { registerBillableSourceProvider } from '@/shared/registries/billable-source.registry';

/**
 * Registers a subscription as something billed on a document of its own, raised by hand: nothing
 * is listed for an order, so placing or confirming one raises no subscription document.
 *
 * A subscription carries no billing cycle yet, so it brings no lines - a period is itemized by hand
 * as `adjustment` lines, which nothing caps. What the provider does hold is the link: a document
 * naming a subscription is refused unless the subscription exists and belongs to that order.
 *
 * `'subscription'` is the `invoice_source.source_type` value naming one.
 */
export default function registerSubscriptionBootstrap() {
	registerBillableSourceProvider('subscription', {
		billedOnce: false,

		listBillable: () => Promise.resolve([]),

		findBillable: async (sourceId: number) => {
			const subscription = await dataSource
				.getRepository(SubscriptionEntity)
				.findOne({
					select: { id: true, order_id: true },
					where: { id: sourceId },
				});

			return subscription
				? {
						id: subscription.id,
						order_id: subscription.order_id,
						lines: [],
					}
				: null;
		},

		getLineCaps: () => Promise.resolve(new Map()),
	});
}
