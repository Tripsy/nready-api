import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { clientAddressPublicController } = await import(
		'@/features/client-address/client-address-public.controller'
	);

	const config: FeatureRoutesModule<typeof clientAddressPublicController> = {
		basePath: '/public/client-addresses',
		controller: clientAddressPublicController,
		/*
		 * Flat rather than nested under `/public/clients/:clientId`: the list and the create carry
		 * `client_id` as a validated field and prove it against the account, and an `/:id` route
		 * reaches the owner through the address's own client - so the path never has to be
		 * cross-checked against the row it names.
		 */
		routes: {
			find: {
				path: '',
				method: 'get',
			},
			create: {
				path: '',
				method: 'post',
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
