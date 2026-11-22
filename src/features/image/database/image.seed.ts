import {
	isDirectRun,
	loadIds,
	randomInt,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ArticleEntity from '@/features/article/article.entity';
import ImageEntity, {
	ImageMimeEnum,
	type ImageSection,
	ImageSectionEnum,
	ImageStatusEnum,
	ImageStorageEnum,
	ImageTypeEnum,
} from '@/features/image/image.entity';
import ProductEntity from '@/features/product/product.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Cover art for the public site: article covers, product covers, and the per-variant galleries
 * a catalog listing variants draws from.
 *
 * Only the rows are seeded here - the bytes live in the **frontend** container, under
 * `nready-ui/public/uploads/`, because `IMAGE_SAVE_PATH` is a frontend setting and the UI is
 * what writes and serves uploads. `nready-ui/.claude/scripts/fetch-seed-images.sh` fetches
 * files for exactly the paths below; a row without its file renders as a broken image, so
 * run the two together.
 *
 * Deliberately partial, and that is the point rather than a shortcut. The storefront resolves a
 * card's picture through a fallback chain - a variant's own gallery, then its product's, and a
 * collapsed card the other way round - so seeding everything would leave every branch but the
 * first untested. Covering two products in three and one variant in three means one pass over
 * the catalog shows all of it: products with art, products falling back to their default
 * variant, variants with their own photograph, variants borrowing their product's, and cards
 * with no image at all.
 */
const COVERED_IN = 2;
const COVERED_OF = 3;

/** Variants are covered more sparsely, so the fallback to the product is the common case. */
const VARIANT_COVERED_IN = 1;
const VARIANT_COVERED_OF = 3;

/** Matches what the fetch script downloads; picsum serves this size. */
const COVER_WIDTH = 1200;
const COVER_HEIGHT = 675;

/**
 * Products are square where articles are 16:9, because that is the shape they are shown in:
 * `ProductCard` renders `aspect-square` and the product page's hero crops to `aspect-video`
 * with `object-cover`. Cropping a wide photo to a square grid loses the middle of it; the
 * reverse only trims top and bottom. These have to match the fetch script, since
 * `properties` is what `next/image` reserves space from.
 */
const PRODUCT_COVER_SIZE = 1000;

/**
 * Stable filename rather than the uuid the upload flow mints: a seed has to be able to name
 * the file it expects, so the fetch script and this row agree without passing state between
 * two projects.
 */
export function buildArticleCoverPath(articleId: EntityId): string {
	return `article/${articleId}/cover.jpg`;
}

export function buildProductCoverPath(productId: EntityId): string {
	return `product/${productId}/cover.jpg`;
}

export function buildVariantCoverPath(variantId: EntityId): string {
	return `product_variant/${variantId}/cover.jpg`;
}

/** One section's worth of work: which rows to cover, and what to record for each. */
type CoverPlan = {
	section: ImageSection;
	entityIds: EntityId[];
	buildPath: (entityId: EntityId) => string;
	width: number;
	height: number;
};

export const imageSeed: SeedDefinition = {
	name: 'image',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const imageRepository = manager.getRepository(ImageEntity);

		/*
		 * Variants are read through their products rather than straight off the table, so a
		 * variant whose product was withdrawn is not given art the storefront will never show.
		 * `loadIds` filters on the variant's own `deleted_at` alone, and the two are separate:
		 * soft-deleting a product does not cascade to its variants.
		 */
		const productIds = await loadIds(manager, ProductEntity);
		const productIdSet = new Set(productIds);

		const variantIds = (
			await manager.getRepository(ProductVariantEntity).find({
				select: { id: true, product_id: true },
				order: { id: 'ASC' },
			})
		)
			.filter((variant) => productIdSet.has(variant.product_id))
			.map((variant) => variant.id);

		const plans: CoverPlan[] = [
			{
				section: ImageSectionEnum.ARTICLE,
				entityIds: await loadIds(manager, ArticleEntity),
				buildPath: buildArticleCoverPath,
				width: COVER_WIDTH,
				height: COVER_HEIGHT,
			},
			{
				section: ImageSectionEnum.PRODUCT,
				entityIds: productIds,
				buildPath: buildProductCoverPath,
				width: PRODUCT_COVER_SIZE,
				height: PRODUCT_COVER_SIZE,
			},
			{
				section: ImageSectionEnum.PRODUCT_VARIANT,
				entityIds: variantIds,
				buildPath: buildVariantCoverPath,
				width: PRODUCT_COVER_SIZE,
				height: PRODUCT_COVER_SIZE,
			},
		];

		let alreadyPresent = 0;
		let inserted = 0;
		let target = 0;

		for (const plan of plans) {
			const [coveredIn, coveredOf] =
				plan.section === ImageSectionEnum.PRODUCT_VARIANT
					? [VARIANT_COVERED_IN, VARIANT_COVERED_OF]
					: [COVERED_IN, COVERED_OF];

			const targetIds = plan.entityIds.filter(
				(_id, index) => index % coveredOf < coveredIn,
			);

			target += targetIds.length;

			/*
			 * Keyed on the target, not on the path: a gallery filled by hand carries uuid
			 * filenames, and matching on the seed's own name would file a second cover against
			 * a product that already has one.
			 */
			const existing = await imageRepository.find({
				select: { entity_id: true },
				where: { section: plan.section },
			});

			const covered = new Set(existing.map((image) => image.entity_id));

			for (const entityId of targetIds) {
				if (covered.has(entityId)) {
					alreadyPresent++;
					continue;
				}

				await imageRepository.save(
					imageRepository.create({
						section: plan.section,
						entity_id: entityId,
						image_type: ImageTypeEnum.GALLERY,
						storage: ImageStorageEnum.LOCAL,
						path: plan.buildPath(entityId),
						properties: {
							width: plan.width,
							height: plan.height,
							mime: ImageMimeEnum.JPEG,
						},
						status: ImageStatusEnum.ACTIVE,
						// Spread out rather than all zero, so "first by sort_order" is a real
						// ordering once a second image is added by hand.
						sort_order: randomInt(random, 1, 10) * 10,
						details: null,
					}),
				);

				inserted++;
			}
		}

		return {
			entity: 'image',
			alreadyPresent,
			inserted,
			target,
			tableTotal: await imageRepository.count(),
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(imageSeed);
}
