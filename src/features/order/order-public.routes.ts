import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { orderPublicController } = await import(
		'@/features/order/order-public.controller'
	);

	const config: FeatureRoutesModule<typeof orderPublicController> = {
		basePath: '/public/orders',
		controller: orderPublicController,
		/*
		 * The one `/:id` route is resolved through `client.user_id` in the same query as the id -
		 * somebody else's order reads as missing, so there is no ownership check left to a later
		 * step.
		 */
		routes: {
			find: {
				path: '',
				method: 'get',
			},
			read: {
				path: '/:id',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
		},
	};

	return config;
};
