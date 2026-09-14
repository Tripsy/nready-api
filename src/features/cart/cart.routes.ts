import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { cartController } = await import('@/features/cart/cart.controller');

	const config: FeatureRoutesModule<typeof cartController> = {
		basePath: '/carts',
		controller: cartController,
		/*
		 * Read-only, plus removal. There is no `create` and no `update`: a cart is what a shopper
		 * accumulated, and a back office that could edit one would be changing the record of what
		 * they chose. Support answers questions about a cart; it does not fill it.
		 */
		routes: {
			read: {
				path: '/:id',
				method: 'get',
				handlers: [validateParamsWhenId('id')],
			},
			find: {
				path: '',
				method: 'get',
			},
			delete: {
				path: '/:id',
				method: 'delete',
				handlers: [validateParamsWhenId('id')],
			},
		},
	};

	return config;
};
