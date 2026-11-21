import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import BrandEntity, {
	BrandStatusEnum,
	BrandTypeEnum,
} from '@/features/brand/brand.entity';
import BrandContentEntity from '@/features/brand/brand-content.entity';
import type { EntityId } from '@/shared/types/entity-id.type';

/** Real manufacturers - products reference these, and the names show up all over the UI. */
const brandNames = [
	'Acer',
	'Anker',
	'Asus',
	'Bosch',
	'Canon',
	'Dell',
	'Garmin',
	'HP',
	'Lenovo',
	'Logitech',
	'Philips',
	'Samsung',
] as const;

function toSlug(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD') // splits accented letters into base + combining mark
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export const brandSeed: SeedDefinition = {
	name: 'brand',
	run: async ({ manager }): Promise<SeedSummary> => {
		const brandRepository = manager.getRepository(BrandEntity);
		const contentRepository = manager.getRepository(BrandContentEntity);

		const existingBrands = await brandRepository.find({
			select: { id: true, slug: true },
			withDeleted: true,
		});

		const idBySlug = new Map<string, EntityId>(
			existingBrands.map((brand) => [brand.slug, brand.id]),
		);

		const pending = brandNames
			.filter((name) => !idBySlug.has(toSlug(name)))
			.map((name, index) =>
				brandRepository.create({
					name,
					slug: toSlug(name),
					status: BrandStatusEnum.ACTIVE,
					brand_type: BrandTypeEnum.PRODUCT,
					sort_order: (idBySlug.size + index + 1) * 10,
					details: null,
				}),
			);

		if (pending.length > 0) {
			const saved = await brandRepository.save(pending, { chunk: 50 });

			for (const brand of saved) {
				idBySlug.set(brand.slug, brand.id);
			}
		}

		const existingContent = await contentRepository.find({
			select: { brand_id: true, language: true },
			withDeleted: true,
		});

		const contentKeys = new Set(
			existingContent.map((content) => `${content.brand_id}:en`),
		);

		const pendingContent = brandNames
			.filter((name) => {
				const brandId = idBySlug.get(toSlug(name));

				return brandId && !contentKeys.has(`${brandId}:en`);
			})
			.map((name) =>
				contentRepository.create({
					brand_id: idBySlug.get(toSlug(name)) as EntityId,
					language: 'en',
					description: `${name} consumer electronics and accessories.`,
					meta: {
						title: name,
						description: `${name} product catalog`,
					},
				}),
			);

		if (pendingContent.length > 0) {
			await contentRepository.save(pendingContent, { chunk: 50 });
		}

		return {
			entity: 'brand',
			alreadyPresent: brandNames.length - pending.length,
			inserted: pending.length,
			target: brandNames.length,
			tableTotal: idBySlug.size,
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(brandSeed);
}
