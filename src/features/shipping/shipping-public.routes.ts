import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { shippingPublicController } = await import(
		'@/features/shipping/shipping-public.controller'
	);

	const config: FeatureRoutesModule<typeof shippingPublicController> = {
		/*
		 * Nested under the buyer's order rather than addressed by shipment id: the order is what the
		 * caller is proven to own, and every movement read here is filtered by it. A `/:id` on the
		 * movement itself would need its own ownership check.
		 */
		basePath: '/public/orders',
		controller: shippingPublicController,
		routes: {
			find: {
				path: '/:order_id/shipments',
				method: 'get',
				handlers: [validateParamsWhenId('order_id')],
			},
		},
	};

	return config;
};
