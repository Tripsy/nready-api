import { validateParamsWhenId } from '@/middleware/validate-params.middleware';
import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { clientPublicController } = await import(
		'@/features/client/client-public.controller'
	);

	const config: FeatureRoutesModule<typeof clientPublicController> = {
		basePath: '/public/clients',
		controller: clientPublicController,
		/*
		 * The one `/:id` route is resolved through `ClientService.findOwnById`, which filters by
		 * the account behind the request in the same query - somebody else's id reads as missing,
		 * so there is no ownership check left to a later step.
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
			update: {
				path: '/:id',
				method: 'put',
				handlers: [validateParamsWhenId('id')],
			},
		},
	};

	return config;
};
