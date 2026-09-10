import {
	isDirectRun,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import CategoryEntity, {
	CategoryStatusEnum,
	type CategoryType,
	CategoryTypeEnum,
} from '@/features/category/category.entity';
import CategoryContentEntity from '@/features/category/category-content.entity';

/**
 * A readable two-level tree rather than generated strings: categories are what the product
 * catalog hangs off, and the names show up all over the UI. `category` itself holds no
 * name - labels and slugs live in `category_content`, so the slug is the natural key here,
 * scoped by `type` exactly as the `(type, slug, language)` unique index scopes it.
 */
type CategorySeedRow = {
	slug: string;
	label: string;
	type: CategoryType;
	parent_slug: string | null;
	description: string;
};

const categoryData: readonly CategorySeedRow[] = [
	// Product - roots
	{
		slug: 'electronics',
		label: 'Electronics',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: null,
		description: 'Computers, displays and everything that plugs in.',
	},
	{
		slug: 'audio',
		label: 'Audio',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: null,
		description: 'Headphones, speakers and personal listening gear.',
	},
	{
		slug: 'accessories',
		label: 'Accessories',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: null,
		description: 'Input devices, cables and desk hardware.',
	},
	{
		slug: 'home-and-garden',
		label: 'Home & Garden',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: null,
		description: 'Tools, lighting and household equipment.',
	},
	{
		slug: 'apparel',
		label: 'Apparel',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: null,
		description:
			"Clothing, sized and colored - the catalog's two-axis family.",
	},
	/*
	 * Food sits beside the hardware tree because it is the catalog's only family where a
	 * product is configured at order time - crust, toppings, a drink chosen inside a menu -
	 * so it is what the option groups and the bundle choices are demonstrated on.
	 */
	{
		slug: 'food',
		label: 'Food',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: null,
		description: 'Kitchen menu - pizza, drinks and what goes beside them.',
	},

	// Product - children
	{
		slug: 'laptops',
		label: 'Laptops',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'electronics',
		description: 'Portable workstations and ultrabooks.',
	},
	{
		slug: 'monitors',
		label: 'Monitors',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'electronics',
		description: 'Desktop displays from office panels to color-grade.',
	},
	{
		slug: 'printers',
		label: 'Printers',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'electronics',
		description: 'Laser and inkjet printers, scanners and consumables.',
	},
	{
		slug: 'headphones',
		label: 'Headphones',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'audio',
		description: 'Over-ear, on-ear and in-ear headphones.',
	},
	{
		slug: 'speakers',
		label: 'Speakers',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'audio',
		description: 'Bookshelf, portable and desktop speakers.',
	},
	{
		slug: 'keyboards',
		label: 'Keyboards',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'accessories',
		description: 'Mechanical and low-profile keyboards.',
	},
	{
		slug: 'mice',
		label: 'Mice',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'accessories',
		description: 'Wired and wireless pointing devices.',
	},
	{
		slug: 'cables',
		label: 'Cables & Adapters',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'accessories',
		description: 'USB-C, HDMI and charging accessories.',
	},
	{
		slug: 'power-tools',
		label: 'Power Tools',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'home-and-garden',
		description: 'Drills, drivers and workshop machines.',
	},
	{
		slug: 'lighting',
		label: 'Lighting',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'home-and-garden',
		description: 'Indoor and outdoor lighting fixtures.',
	},
	/*
	 * The only category whose products vary on two axes at once, which is what makes it the
	 * place a size x color variant grid is demonstrated.
	 */
	{
		slug: 't-shirts',
		label: 'T-Shirts',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'apparel',
		description: 'Printed and plain tees, in every size and color.',
	},
	{
		slug: 'pizza',
		label: 'Pizza',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'food',
		description: 'Stone-baked pizza, sized by the centimetre.',
	},
	{
		slug: 'drinks',
		label: 'Drinks',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'food',
		description: 'Soft drinks, water and juice by the bottle.',
	},
	{
		slug: 'sauces',
		label: 'Sauces & Dips',
		type: CategoryTypeEnum.PRODUCT,
		parent_slug: 'food',
		description: 'Dips and sauces served on the side.',
	},

	/*
	 * Article - a second tree under the same table, so the `type` discriminator and the
	 * `IDX_category_type` index are exercised by the demo data rather than only by tests.
	 */
	{
		slug: 'news',
		label: 'News',
		type: CategoryTypeEnum.ARTICLE,
		parent_slug: null,
		description: 'Product announcements and store updates.',
	},
	{
		slug: 'guides',
		label: 'Guides',
		type: CategoryTypeEnum.ARTICLE,
		parent_slug: null,
		description: 'How-to articles and buying advice.',
	},
	{
		slug: 'reviews',
		label: 'Reviews',
		type: CategoryTypeEnum.ARTICLE,
		parent_slug: 'guides',
		description: 'Hands-on write-ups of catalog products.',
	},
];

/** Slugs repeat across types, so the lookup key has to carry the type as well. */
function categoryKey(type: CategoryType, slug: string): string {
	return `${type}:${slug}`;
}

export const categorySeed: SeedDefinition = {
	name: 'category',
	run: async ({ manager }): Promise<SeedSummary> => {
		const categoryRepository = manager.getRepository(CategoryEntity);
		const contentRepository = manager.getRepository(CategoryContentEntity);

		// `type` is `select: false` on the content entity, so it has to be asked for
		// explicitly - without it every existing row would key as `undefined:<slug>`.
		const existingContent = await contentRepository.find({
			select: {
				category_id: true,
				language: true,
				slug: true,
				type: true,
			},
			withDeleted: true,
		});

		// Key → id for every category already stored, extended as this run inserts more.
		const idByKey = new Map<string, number>(
			existingContent.map((content) => [
				categoryKey(content.type, content.slug),
				content.category_id,
			]),
		);

		const contentKeys = new Set(
			existingContent.map(
				(content) => `${content.category_id}:${content.language}`,
			),
		);

		const sortOrderByParent = new Map<string, number>();
		const inserted: CategorySeedRow[] = [];

		/*
		 * Sequential rather than batched: a child needs its parent's generated id, and the
		 * closure table is written by TypeORM's persistence executor on save - which is why
		 * the parent is assigned as an entity (`@TreeParent`) and not as a `parent_id`.
		 */
		for (const category of categoryData) {
			const key = categoryKey(category.type, category.slug);

			if (idByKey.has(key)) {
				continue;
			}

			const parentKey = category.parent_slug
				? categoryKey(category.type, category.parent_slug)
				: null;

			const parentId = parentKey ? idByKey.get(parentKey) : undefined;

			if (parentKey && !parentId) {
				throw new Error(
					`Category "${category.slug}" references unknown parent "${category.parent_slug}"`,
				);
			}

			const siblingGroup = parentKey ?? `${category.type}:root`;
			const sortOrder = (sortOrderByParent.get(siblingGroup) ?? 0) + 10;

			sortOrderByParent.set(siblingGroup, sortOrder);

			const parent = parentId
				? await categoryRepository.findOneBy({ id: parentId })
				: null;

			const saved = await categoryRepository.save(
				categoryRepository.create({
					type: category.type,
					status: CategoryStatusEnum.ACTIVE,
					sort_order: sortOrder,
					parent,
					details: undefined,
				}),
			);

			idByKey.set(key, saved.id);
			inserted.push(category);
		}

		// Labels live in the content table, one row per language.
		const pendingContent = categoryData
			.filter((category) => {
				const categoryId = idByKey.get(
					categoryKey(category.type, category.slug),
				);

				return categoryId && !contentKeys.has(`${categoryId}:en`);
			})
			.map((category) =>
				contentRepository.create({
					category_id: idByKey.get(
						categoryKey(category.type, category.slug),
					) as number,
					language: 'en',
					type: category.type,
					label: category.label,
					slug: category.slug,
					description: category.description,
					meta: {
						title: category.label,
						description: category.description,
					},
					details: null,
				}),
			);

		if (pendingContent.length > 0) {
			await contentRepository.save(pendingContent, { chunk: 50 });
		}

		return {
			entity: 'category',
			alreadyPresent: categoryData.length - inserted.length,
			inserted: inserted.length,
			target: categoryData.length,
			// Counted rather than derived from `idByKey`: a category may carry no content
			// row at all, and those rows are absent from that map.
			tableTotal: await categoryRepository.count({ withDeleted: true }),
		};
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(categorySeed);
}
