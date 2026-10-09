import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { shippingPublicController } = await import(
		'@/features/shipping/shipping-public.controller'
	);

	const config: FeatureRoutesModule<typeof shippingPublicController> = {
		basePath: '/public',
		controller: shippingPublicController,
		routes: {
			/*
			 * Nested under the buyer's order rather than addressed by shipment id: the order is what
			 * the caller is proven to own, and every movement read here is filtered by it. A `/:id`
			 * on the movement itself would need its own ownership check.
			 */
			find: {
				path: '/orders/:order_id/shipments',
				method: 'get',
				handlers: [validateParamsWhenId('order_id')],
			},
			/*
			 * Not `/orders/shipments`: `order-public.routes.ts` owns `/orders/:id`, which would
			 * take `shipments` for an id.
			 */
			findByOrders: {
				path: '/shipments',
				method: 'get',
			},
		},
	};

	return config;
};
