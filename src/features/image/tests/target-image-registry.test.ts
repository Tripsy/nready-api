import { expect, jest } from '@jest/globals';
import {
	registerTargetImageProvider,
	resolveTargetImages,
	type TargetImage,
	type TargetImageProvider,
	TargetImageTypeEnum,
} from '@/shared/registries/target-image.registry';

/**
 * The registry that keeps `image` optional. Its own file because the provider slot is module
 * state with no way to unregister - a suite sharing the module with tests that expect the
 * unregistered default would have to depend on execution order to get it.
 *
 * Order matters within this file for the same reason: the empty-registry case runs first, since
 * every later test leaves a provider behind.
 */
describe('target-image.registry', () => {
	const image: TargetImage = {
		id: 1,
		path: '/articles/cover.jpg',
		storage: 'local',
		properties: { width: 240, height: 240 },
	};

	const createProvider = (result: Map<number, TargetImage>) =>
		jest.fn<TargetImageProvider>().mockResolvedValue(result);

	// The state of a deployment without the image feature, and of every request under `test`,
	// where `bootstrap.setup.ts` never runs.
	it('should answer empty when no provider is registered', async () => {
		await expect(
			resolveTargetImages('article', TargetImageTypeEnum.GALLERY, [1, 2]),
		).resolves.toEqual(new Map());
	});

	it('should pass the section, the type and the ids to a registered provider', async () => {
		const provider = createProvider(new Map([[1, image]]));

		registerTargetImageProvider(provider);

		const images = await resolveTargetImages(
			'article',
			TargetImageTypeEnum.GALLERY,
			[1, 2],
		);

		expect(provider).toHaveBeenCalledWith(
			'article',
			TargetImageTypeEnum.GALLERY,
			[1, 2],
		);
		expect(images.get(1)).toEqual(image);
	});

	// The type travels through untouched, so a brand asking for its logo reaches the same provider
	// as an article asking for a gallery image.
	it('should carry the requested type through to the provider', async () => {
		const provider = createProvider(new Map());

		registerTargetImageProvider(provider);

		await resolveTargetImages('brand', TargetImageTypeEnum.LOGO, [4]);

		expect(provider).toHaveBeenCalledWith(
			'brand',
			TargetImageTypeEnum.LOGO,
			[4],
		);
	});

	// The guard sits in front of the provider, so an empty page costs no call at all.
	it('should not consult the provider for an empty set of ids', async () => {
		const provider = createProvider(new Map());

		registerTargetImageProvider(provider);

		await expect(
			resolveTargetImages('article', TargetImageTypeEnum.GALLERY, []),
		).resolves.toEqual(new Map());
		expect(provider).not.toHaveBeenCalled();
	});

	it('should replace the previous provider rather than add a second', async () => {
		const first = createProvider(new Map([[1, image]]));
		const second = createProvider(new Map());

		registerTargetImageProvider(first);
		registerTargetImageProvider(second);

		await resolveTargetImages('article', TargetImageTypeEnum.GALLERY, [1]);

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalled();
	});
});
