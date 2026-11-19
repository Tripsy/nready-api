import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { productPublicController } = await import(
		'@/features/product/product-public.controller'
	);

	const config: FeatureRoutesModule<typeof productPublicController> = {
		basePath: '/public/products',
		controller: productPublicController,
		routes: {
			find: {
				path: '',
				method: 'get',
			},
			// Two segments, so `/:slug` never takes it - an id is not a slug's shape anyway
			stock: {
				path: '/:id/stock',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
			read: {
				path: '/:slug',
				method: 'get',
			},
		},
	};

	return config;
};
