import { OrderStatusEnum } from '@/features/order/order.entity';
import {
	validateParamsWhenEnum,
	validateParamsWhenId,
} from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { orderController } = await import(
		'@/features/order/order.controller'
	);

	const config: FeatureRoutesModule<typeof orderController> = {
		basePath: '/orders',
		controller: orderController,
		routes: {
			create: {
				path: '',
				method: 'post',
			},
			read: {
				path: '/:id',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
			update: {
				path: '/:id',
				method: 'put',
				handlers: [validateParamsWhenId('id')],
			},
			delete: {
				path: '/:id',
				method: 'delete',
				handlers: [validateParamsWhenId('id')],
			},
			restore: {
				path: '/:id/restore',
				method: 'patch',
				handlers: [validateParamsWhenId('id')],
			},
			find: {
				path: '',
				method: 'get',
			},
			statusUpdate: {
				path: '/:id/status/:status',
				method: 'patch',
				handlers: [
					validateParamsWhenId('id'),
					validateParamsWhenEnum({
						status: Object.values(OrderStatusEnum),
					}),
				],
			},
		},
	};

	return config;
};
