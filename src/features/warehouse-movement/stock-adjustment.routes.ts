import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { stockAdjustmentController } = await import(
		'@/features/warehouse-movement/stock-adjustment.controller'
	);

	const config: FeatureRoutesModule<typeof stockAdjustmentController> = {
		basePath: '/stock-adjustments',
		controller: stockAdjustmentController,
		routes: {
			create: {
				path: '',
				method: 'post',
			},
			reverse: {
				path: '/:id/reverse',
				method: 'patch',
				handlers: [validateParamsWhenId('id')],
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
