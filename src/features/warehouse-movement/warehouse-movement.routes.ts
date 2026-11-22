import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { warehouseMovementController } = await import(
		'@/features/warehouse-movement/warehouse-movement.controller'
	);

	const config: FeatureRoutesModule<typeof warehouseMovementController> = {
		basePath: '/warehouse-movements',
		controller: warehouseMovementController,
		routes: {
			// Both ahead of `read`: `/:id` would take `stock` or `low-stock` as an id and refuse it
			lowStock: {
				path: '/low-stock',
				method: 'get',
			},
			stock: {
				path: '/stock/:variant_id',
				method: 'get',
				handlers: [validateParamsWhenId('variant_id')],
			},
			read: {
				path: '/:id',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
			find: {
				path: '',
				method: 'get',
			},
		},
	};

	return config;
};
