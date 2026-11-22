import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { orderReturnPublicController } = await import(
		'@/features/order-return/order-return-public.controller'
	);

	const config: FeatureRoutesModule<typeof orderReturnPublicController> = {
		basePath: '/public',
		controller: orderReturnPublicController,
		routes: {
			/*
			 * Nested under the buyer's order, as shipments are: the order is what the caller is
			 * proven to own, and every return read or written here is resolved through it.
			 */
			find: {
				path: '/orders/:order_id/returns',
				method: 'get',
				handlers: [validateParamsWhenId('order_id')],
			},
			returnable: {
				path: '/orders/:order_id/returnable',
				method: 'get',
				handlers: [validateParamsWhenId('order_id')],
			},
			create: {
				path: '/orders/:order_id/returns',
				method: 'post',
				handlers: [validateParamsWhenId('order_id')],
			},
			cancel: {
				path: '/orders/:order_id/returns/:id/cancel',
				method: 'patch',
				handlers: [validateParamsWhenId('order_id', 'id')],
			},
		},
	};

	return config;
};
