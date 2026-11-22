/**
 * Prints the stored `path` of every image row in a section, one per line. The line carries a
 * second, tab-separated column: the URL of the photograph that file is meant to hold
 * (`image.sources.ts`) - the product's for a product or a variant, the article's for an article -
 * or nothing when none is listed for the row.
 *
 * The bytes of an image live in the frontend project (`IMAGE_SAVE_PATH` is a `nready-ui`
 * setting), so a tool over there has to be able to ask this database what files it is
 * expected to hold - `nready-ui/.claude/scripts/fetch-seed-images.sh` is the caller.
 *
 * Usage: npx tsx cli/list-image-paths.ts [section]   (default: article)
 */
import dataSource from '@/config/data-source.config';
import ArticleContentEntity from '@/features/article/article-content.entity';
import {
	buildCommonsPhotoUrl,
	resolveArticlePhoto,
	resolveProductPhoto,
} from '@/features/image/database/image.sources';
import ImageEntity, {
	type ImageSection,
	ImageSectionEnum,
} from '@/features/image/image.entity';
import ProductContentEntity from '@/features/product/product-content.entity';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import type { EntityId } from '@/shared/types/entity-id.type';

/** Wide enough to crop a 1000px square, or a 1200px-wide 16:9 cover, out of a landscape photograph. */
const PHOTO_WIDTH = 1600;

const requested = process.argv[2] ?? ImageSectionEnum.ARTICLE;

const sections = Object.values(ImageSectionEnum) as string[];

if (!sections.includes(requested)) {
	console.error(
		`Unknown section "${requested}". Available: ${sections.join(', ')}`,
	);
	process.exit(1);
}

await dataSource.initialize();

try {
	const rows = await dataSource.getRepository(ImageEntity).find({
		select: { path: true, entity_id: true },
		where: { section: requested as ImageSection },
		order: { entity_id: 'ASC', sort_order: 'ASC' },
	});

	const isProductSection =
		requested === ImageSectionEnum.PRODUCT ||
		requested === ImageSectionEnum.PRODUCT_VARIANT;

	const labelByProductId = new Map(
		isProductSection
			? (
					await dataSource.getRepository(ProductContentEntity).find({
						select: { product_id: true, label: true },
						where: { language: 'en' },
					})
				).map((content) => [content.product_id, content.label])
			: [],
	);

	const productIdByVariantId = new Map(
		requested === ImageSectionEnum.PRODUCT_VARIANT
			? (
					await dataSource.getRepository(ProductVariantEntity).find({
						select: { id: true, product_id: true },
					})
				).map((variant) => [variant.id, variant.product_id])
			: [],
	);

	const titleByArticleId = new Map(
		requested === ImageSectionEnum.ARTICLE
			? (
					await dataSource.getRepository(ArticleContentEntity).find({
						select: { article_id: true, title: true },
						where: { language: 'en' },
					})
				).map((content) => [content.article_id, content.title])
			: [],
	);

	/** How many covered variants of each product have been printed so far. */
	const variantCountByProductId = new Map<EntityId, number>();

	/** The photo a row's file should hold; null when `image.sources.ts` lists none for it. */
	const photoFor = (entityId: EntityId): string | null => {
		if (requested === ImageSectionEnum.ARTICLE) {
			return resolveArticlePhoto(titleByArticleId.get(entityId) ?? '');
		}

		if (requested === ImageSectionEnum.PRODUCT) {
			return resolveProductPhoto(
				labelByProductId.get(entityId) ?? '',
				null,
			);
		}

		if (requested === ImageSectionEnum.PRODUCT_VARIANT) {
			const productId = productIdByVariantId.get(entityId);

			if (!productId) {
				return null;
			}

			const variantIndex = variantCountByProductId.get(productId) ?? 0;

			variantCountByProductId.set(productId, variantIndex + 1);

			return resolveProductPhoto(
				labelByProductId.get(productId) ?? '',
				variantIndex,
			);
		}

		return null;
	};

	// stdout only, one row per line: the caller reads this with `while read`.
	for (const row of rows) {
		const photo = photoFor(row.entity_id);

		console.log(
			photo
				? `${row.path}\t${buildCommonsPhotoUrl(photo, PHOTO_WIDTH)}`
				: row.path,
		);
	}
} finally {
	await dataSource.destroy();
}

/*
 * Explicit, the way `seed.runner.ts` and the seed index end: closing the data source is not
 * enough to end the process, because importing the entity graph opens handles this tool never
 * asked for and only `server.ts` closes (the Redis client among them). Without this the paths
 * are printed and the process then hangs - and the caller,
 * `nready-ui/.claude/scripts/fetch-seed-images.sh`, reads them through a command substitution,
 * which waits for EOF and so waits forever.
 */
process.exit(0);
