import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { clientPublicController } = await import(
		'@/features/client/client-public.controller'
	);

	const config: FeatureRoutesModule<typeof clientPublicController> = {
		basePath: '/public/clients',
		controller: clientPublicController,
		/*
		 * No `/:id` routes: every row here is addressed through the account behind the request,
		 * so there is no id for the caller to name and no ownership check left to a later step.
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
		},
	};

	return config;
};
