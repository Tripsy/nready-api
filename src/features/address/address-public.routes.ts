import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { addressPublicController } = await import(
		'@/features/address/address-public.controller'
	);

	const config: FeatureRoutesModule<typeof addressPublicController> = {
		basePath: '/public/addresses',
		controller: addressPublicController,
		routes: {
			find: {
				path: '',
				method: 'get',
			},
		},
	};

	return config;
};
