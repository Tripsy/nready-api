import { MANUAL_STATUSES } from '@/features/order-return/order-return.entity';
import {
	validateParamsWhenEnum,
	validateParamsWhenId,
} from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { orderReturnController } = await import(
		'@/features/order-return/order-return.controller'
	);

	const config: FeatureRoutesModule<typeof orderReturnController> = {
		basePath: '/order-returns',
		controller: orderReturnController,
		routes: {
			create: {
				path: '',
				method: 'post',
			},
			// Ahead of `/:id`, or Express takes `returnable` for an id
			returnable: {
				path: '/returnable/:order_id',
				method: 'get',
				handlers: [validateParamsWhenId('order_id')],
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
			approve: {
				path: '/:id/approve',
				method: 'post',
				handlers: [validateParamsWhenId('id')],
			},
			refund: {
				path: '/:id/refund',
				method: 'post',
				handlers: [validateParamsWhenId('id')],
			},
			statusUpdate: {
				path: '/:id/status/:status',
				method: 'patch',
				handlers: [
					validateParamsWhenId('id'),
					validateParamsWhenEnum({
						status: [...MANUAL_STATUSES],
					}),
				],
			},
		},
	};

	return config;
};
