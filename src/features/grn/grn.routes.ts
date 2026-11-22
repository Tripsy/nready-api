import { GrnStatusEnum } from '@/features/grn/grn.entity';
import {
	validateParamsWhenEnum,
	validateParamsWhenId,
} from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { grnController } = await import('@/features/grn/grn.controller');

	const config: FeatureRoutesModule<typeof grnController> = {
		basePath: '/grns',
		controller: grnController,
		routes: {
			create: {
				path: '',
				method: 'post',
			},
			// Ahead of `read`: `/:id` would take `cost-over-floor` as an id and refuse it
			costOverFloor: {
				path: '/cost-over-floor',
				method: 'get',
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
						status: Object.values(GrnStatusEnum),
					}),
				],
			},
		},
	};

	return config;
};
