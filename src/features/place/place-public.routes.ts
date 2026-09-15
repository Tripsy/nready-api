import type { FeatureRoutesModule } from '@/shared/types/routes.type';

export default async () => {
	const { placePublicController } = await import(
		'@/features/place/place-public.controller'
	);

	const config: FeatureRoutesModule<typeof placePublicController> = {
		basePath: '/public/places',
		controller: placePublicController,
		routes: {
			find: {
				path: '',
				method: 'get',
			},
		},
	};

	return config;
};
