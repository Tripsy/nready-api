import {
	type DeepPartial,
	type EntityManager,
	In,
	QueryFailedError,
} from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import {
	resolveTargetImageLists,
	resolveTargetImages,
	type TargetImage,
	TargetImageTypeEnum,
} from '@/config/target-image.config';
import { CustomError } from '@/exceptions';
import CategoryEntity from '@/features/category/category.entity';
import ProductEntity, {
	type ProductComposition,
	ProductCompositionEnum,
	type ProductSaleStatus,
	ProductSaleStatusEnum,
	ProductTypeEnum,
	ProductUnitEnum,
	type ProductWorkflow,
	UNITS_BY_TYPE,
	WORKFLOW_TRANSITIONS,
} from '@/features/product/product.entity';
import { getProductRepository } from '@/features/product/product.repository';
import type {
	ProductAttributeType,
	ProductBundleItemType,
	ProductValidator,
} from '@/features/product/product.validator';
import ProductAttributeEntity from '@/features/product/product-attribute.entity';
import ProductAttributeRepository, {
	type ResolvedAttributeValue,
} from '@/features/product/product-attribute.repository';
import ProductAvailabilityEntity from '@/features/product/product-availability.entity';
import ProductAvailabilityRepository from '@/features/product/product-availability.repository';
import type { ResolvedBundleItem } from '@/features/product/product-bundle.repository';
import ProductBundleRepository from '@/features/product/product-bundle.repository';
import ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import { productBundleSelectionService } from '@/features/product/product-bundle-selection.service';
import ProductCategoryRepository from '@/features/product/product-category.repository';
import type ProductCategoryAttributeEntity from '@/features/product/product-category-attribute.entity';
import {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import {
	attributeLabelName,
	productCategoryAttributeService,
} from '@/features/product/product-category-attribute.service';
import { SLUG_UNIQUE_INDEX } from '@/features/product/product-content.entity';
import ProductContentRepository from '@/features/product/product-content.repository';
import ProductOptionRepository from '@/features/product/product-option.repository';
import ProductOptionGroupEntity from '@/features/product/product-option-group.entity';
import ProductTagRepository from '@/features/product/product-tag.repository';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import ProductVariantRepository, {
	type ResolvedVariant,
} from '@/features/product/product-variant.repository';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { apportion, resolveVatRate, roundMoney } from '@/helpers/shop.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { MeasureUnit } from '@/shared/types/measure-unit.type';
import { toBaseUnit } from '@/shared/types/measure-unit.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * Columns owned by the product row itself - everything else lives in a child table
 * (`product_content`, `product_variant`, `product_attribute`, and the option and bundle trees).
 */
const entryColumns: string[] = [
	'type',
	'composition',
	'unit',
	'vat_category',
	'available_from',
	'available_until',
	'discontinued_at',
	'brand_id',
];

const slugConflictError = (): CustomError =>
	new CustomError(409, lang('product.error.slug_already_exists'));

/** The picture a listing shows for a product: the first of its gallery, by `sort_order`. */
export type ProductCoverImageType = TargetImage;

export type WithCoverImage<T> = T & {
	cover_image: ProductCoverImageType | null;
};

/**
 * Every live variant of a listed product, axis wording resolved and each carrying its own cover -
 * see `attachVariants`.
 */
export type WithVariants<T> = T & {
	variants: WithCoverImage<ProductVariantEntity>[];
};

/**
 * One of the product's own attributes as the storefront needs it: the stored row, its label and
 * value terms resolved into the served language, and the quoting the definition fixes.
 *
 * `unit` and `suffix` are copied off the `product_category_attribute` definition rather than
 * left for the client to look up. A bare `330` is not a value - what makes it one is the unit
 * the definition pins, and the client would otherwise have to fetch the whole resolved form of
 * every category the product sits in to render one line of a spec table.
 */
export type PublicProductAttribute = ProductAttributeEntity & {
	unit: MeasureUnit | null;
	suffix: string | null;
};

/** The product's own attributes, named and ordered - see `attachPublicAttributes`. */
export type WithPublicAttributes<T> = T & {
	attributes: PublicProductAttribute[];
};

/**
 * A choice offered inside a bundle, as the storefront needs it: the prompt resolved into the
 * served language, and nothing else. The dashboard's own read hands back every translation,
 * because it edits them all at once; a visitor is served one.
 */
export type PublicBundleGroup = {
	id: number;
	label_id: number;
	position: number;
	label: {
		id: number;
		contents: { language: string; value: string }[];
	} | null;
};

/**
 * One component of a bundle, with what a page needs to draw it.
 *
 * `variant` and `label` are the reason this projection exists. A component names a variant of
 * **another** product, so nothing in the bundle's own read can name it - `attachVariants` resolves
 * the axis wording of this product's variants and has no reach outside it. Without them a chooser
 * has an id and a delta and no way to say what the customer is choosing between.
 *
 * Prices come per currency on both figures, exactly as `attachVariants` hands them over, because
 * the public read takes no currency: `publicRead` accepts a slug and a language, the payload is
 * cached under those two alone, and the client picks its own market. Narrowing here would put a
 * currency in a cache key that has never carried one.
 *
 * The timestamps and `item_id` the dashboard's shape carries are dropped, like every other public
 * projection on this route.
 */
export type PublicBundleComponent = {
	id: number;
	variant_id: number;
	quantity: number;
	group_id: number | null;
	position: number;
	is_optional: boolean;
	is_default: boolean;
	prices: { currency: string; price_delta: number }[];
	variant: {
		id: number;
		sku: string;
		prices: {
			currency: string;
			sale_price: number | null;
			reference_price: number | null;
		}[];
	} | null;
	/** The component product's own label, in the served language. */
	label: string | null;
	/**
	 * The component product's VAT rate, in percent. A bundle's price is apportioned across its
	 * components and each share taxed at its own rate, so a page quoting a configured bundle
	 * VAT-inclusive needs every component's rate to reach the figure the cart will charge.
	 */
	vat_rate: number;
};

/** A bundle's composition as the storefront reads it - see `attachPublicComposition`. */
export type WithComposition<T> = T & {
	bundle_groups: PublicBundleGroup[];
	bundle_items: PublicBundleComponent[];
};

/**
 * Every picture the product and each of its variants carry - see `attachPublicGalleries`.
 *
 * Beside `cover_image` rather than instead of it: the cover is the one image that stands for the
 * row and a listing reads nothing else, so a detail page gaining the set must not change what a
 * card is handed. The cover is the head of `images` whenever the product has any.
 */
export type WithGallery<T> = T & {
	images: TargetImage[];
};

/**
 * How many units a bundle has to add up to before it is a bundle rather than a product.
 *
 * Counted over the components that are always included, so the floor holds for the cheapest
 * thing the customer can walk away with - see `assertBundleIsComposed`.
 */
const BUNDLE_MINIMUM_UNITS = 2;

/**
 * How many candidates a choice needs before it is a choice.
 *
 * A group takes exactly one of its candidates, so one candidate is not an alternative to anything
 * - see `assertBundleGroupsAreUsable`.
 */
const BUNDLE_GROUP_MINIMUM_CANDIDATES = 2;

export class ProductService {
	constructor(private repository: ReturnType<typeof getProductRepository>) {}

	/**
	 * Both slug checks read outside the transaction that writes the content, so two concurrent
	 * requests can find the same slug free and only the second meets the `(slug, language)`
	 * unique index. Postgres answers that with a bare unique violation, which the error handler
	 * would mask as a 500 - mapped back onto the same 409 the pre-check raises so the race and
	 * the ordinary case read alike.
	 *
	 * The variant code indexes are handled here too, and separately: a SKU and a barcode are
	 * different things a warehouse speaks, so "this code is taken" has to name which one.
	 */
	private async withConflictGuard<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (
				!RepositoryAbstract.isUniqueViolation(error) ||
				!(error instanceof QueryFailedError)
			) {
				throw error;
			}

			switch (error.driverError?.constraint) {
				case SLUG_UNIQUE_INDEX:
					throw slugConflictError();
				case 'IDX_product_variant_sku':
					throw new CustomError(
						409,
						lang('product.error.variant_sku_already_exists'),
					);
				case 'IDX_product_variant_barcode':
					throw new CustomError(
						409,
						lang('product.error.barcode_already_exists'),
					);
				default:
					throw error;
			}
		}
	}

	/**
	 * `sale_status` is derived, never stated: the timestamps are what an editor edits and this
	 * is only their projection, which is why the column carries no transition map.
	 *
	 * Applied on every write as well as by the recompute cron. The cron is what moves a product as
	 * time passes; without this, a product created with a future `available_from` would be
	 * listed as sellable until the next pass.
	 */
	private resolveSaleStatus(entry: {
		available_from: Date | null;
		available_until: Date | null;
		discontinued_at: Date | null;
	}): ProductSaleStatus {
		const now = new Date();

		if (entry.discontinued_at && entry.discontinued_at <= now) {
			return ProductSaleStatusEnum.DISCONTINUED;
		}

		if (entry.available_from && entry.available_from > now) {
			return ProductSaleStatusEnum.COMING_SOON;
		}

		if (entry.available_until && entry.available_until <= now) {
			return ProductSaleStatusEnum.UNAVAILABLE;
		}

		return ProductSaleStatusEnum.AVAILABLE;
	}

	/**
	 * The catalog window on the row as it will be saved.
	 *
	 * The validator rejects a payload carrying both dates inverted, but it only sees the
	 * payload: an update that moves `available_until` alone is compared against nothing there.
	 * This runs after the merge, where both values are known.
	 */
	private assertAvailabilityWindow(entry: ProductEntity): void {
		if (!entry.available_from || !entry.available_until) {
			return;
		}

		if (entry.available_until > entry.available_from) {
			return;
		}

		throw new CustomError(
			422,
			lang('product.validation.available_until_before_from'),
		);
	}

	/**
	 * The type/unit pairing on the row as it will be saved.
	 *
	 * Not a validator rule for the same reason as the availability window above: `type` and
	 * `unit` are each independently updatable, so a payload moving one alone has nothing to
	 * compare against. This runs after the merge, where both values are known.
	 */
	private assertUnitForType(entry: ProductEntity): void {
		if (UNITS_BY_TYPE[entry.type].includes(entry.unit)) {
			return;
		}

		throw new CustomError(
			422,
			lang('product.validation.invalid_unit_for_type', {
				type: entry.type,
				unit: entry.unit,
			}),
		);
	}

	public async create(
		data: ValidatorOutput<ProductValidator, 'create'>,
	): Promise<ProductEntity> {
		const conflict = await ProductContentRepository.findConflictingSlug(
			data.contents,
		);

		if (conflict) {
			throw slugConflictError();
		}

		return this.withConflictGuard(() =>
			dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(ProductEntity);

				/*
				 * `type` and `unit` carry their column defaults explicitly because
				 * `repository.create()` does not apply them and `assertUnitForType` below
				 * reads both before the insert - an omitted `type` would index
				 * `UNITS_BY_TYPE` with `undefined`. The other defaulted columns are only
				 * read after `save`, which back-fills them through `RETURNING`.
				 */
				const entry = repository.create({
					type: data.type ?? ProductTypeEnum.PHYSICAL,
					composition: data.composition,
					unit: data.unit ?? ProductUnitEnum.PIECE,
					vat_category: data.vat_category,
					available_from: data.available_from,
					available_until: data.available_until,
					discontinued_at: data.discontinued_at,
					brand_id: data.brand_id,
				});

				this.assertAvailabilityWindow(entry);
				this.assertUnitForType(entry);

				entry.sale_status = this.resolveSaleStatus(entry);

				const saved = await repository.save(entry);

				await this.saveRelations(manager, saved, data, data.categories);

				return saved;
			}),
		);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<ProductEntity> & { id: number },
	): Promise<ProductEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(ProductEntity, saved.id);

		return saved;
	}

	public async updateDataWithContent(
		entry: ProductEntity,
		data: ValidatorOutput<ProductValidator, 'update'>,
	): Promise<ProductEntity> {
		if (data.contents?.length) {
			const conflict = await ProductContentRepository.findConflictingSlug(
				data.contents,
				entry.id,
			);

			if (conflict) {
				throw slugConflictError();
			}
		}

		/*
		 * The attribute definitions are resolved from the product's categories, so a payload
		 * that omits the links has to be checked against the ones already stored - otherwise
		 * an edit that only changes an attribute would be validated against no schema at all.
		 */
		const categoryIds =
			data.categories ?? (await this.loadCategoryIds(entry.id));

		const updatedEntry = await this.withConflictGuard(() =>
			dataSource.transaction(async (manager) => {
				const repository = manager.getRepository(ProductEntity);

				Object.assign(entry, pickValuesFromObject(data, entryColumns));

				this.assertAvailabilityWindow(entry);
				this.assertUnitForType(entry);

				entry.sale_status = this.resolveSaleStatus(entry);

				const saved = await repository.save(entry);

				await this.saveRelations(manager, saved, data, categoryIds);

				return saved;
			}),
		);

		/*
		 * One clean for the whole operation, emitted after the transaction commits. The child
		 * rows written above carry no subscribers of their own: a row-level hook fires once per
		 * row - a product with four variants and twelve prices meant sixteen identical Redis
		 * SCANs - and it fires *inside* the transaction, where a concurrent reader can refill
		 * the cache from a snapshot about to be superseded.
		 */
		await cleanEntityCache(ProductEntity, updatedEntry.id);

		return updatedEntry;
	}

	private async loadCategoryIds(product_id: number): Promise<number[]> {
		const links = await ProductCategoryRepository.createQuery()
			.select(['product_category.category_id'])
			.filterBy('product_category.product_id', product_id)
			.all();

		return links.map((link) => link.category_id);
	}

	/**
	 * Every child table, in an order the foreign keys allow: the bundle tree names variants, so
	 * the variants of this product have to exist before it is written.
	 *
	 * An absent key means "leave alone" and an empty array means "clear" - the same contract
	 * the article feature uses, and the reason a partial update can touch one branch of a
	 * product without restating the rest of it.
	 */
	private async saveRelations(
		manager: EntityManager,
		entry: ProductEntity,
		data: Partial<ValidatorOutput<ProductValidator, 'create'>>,
		categoryIds: number[],
	): Promise<void> {
		await ProductContentRepository.saveContent(
			manager,
			data.contents ?? [],
			entry.id,
		);

		if (data.categories) {
			await ProductCategoryRepository.syncLinks(
				manager,
				entry.id,
				data.categories,
			);
		}

		if (data.tags) {
			await ProductTagRepository.syncLinks(manager, entry.id, data.tags);
		}

		if (data.variants) {
			await ProductVariantRepository.syncVariants(
				manager,
				entry.id,
				await this.resolveVariants(
					data.variants,
					categoryIds,
					entry.composition,
				),
			);
		}

		if (data.attributes) {
			await ProductAttributeRepository.syncValues(
				manager,
				entry.id,
				await this.resolveAttributeValues(
					data.attributes,
					categoryIds,
					ProductCategoryAttributeScopeEnum.PRODUCT,
				),
			);
		}

		if (data.availabilities) {
			await ProductAvailabilityRepository.syncWindows(
				manager,
				entry.id,
				data.availabilities,
			);
		}

		if (data.option_groups) {
			await ProductOptionRepository.syncGroups(
				manager,
				entry.id,
				data.option_groups,
			);
		}

		await this.saveComposition(manager, entry, data);
	}

	/**
	 * The bundle tree, plus the two rules the schema cannot hold.
	 *
	 * A `simple` product has its components cleared rather than left in place: switching the
	 * composition back is how a bundle is unmade, and rows nothing reads still name variants
	 * whose delete they would then block through the RESTRICT foreign key.
	 */
	private async saveComposition(
		manager: EntityManager,
		entry: ProductEntity,
		data: Partial<ValidatorOutput<ProductValidator, 'create'>>,
	): Promise<void> {
		if (entry.composition === ProductCompositionEnum.SIMPLE) {
			// Components first: a group is only removable once nothing is a candidate for it
			await ProductBundleRepository.syncItems(manager, entry.id, []);
			await ProductBundleRepository.syncGroups(manager, entry.id, []);

			return;
		}

		const items = data.bundle_items;

		await this.assertComponents(manager, entry, items ?? []);

		if (data.bundle_groups) {
			await ProductBundleRepository.syncGroups(
				manager,
				entry.id,
				data.bundle_groups,
			);
		}

		if (items) {
			await ProductBundleRepository.syncItems(
				manager,
				entry.id,
				await this.resolveComponentGroups(manager, entry.id, items),
			);
		}

		await this.assertBundleIsComposed(manager, entry.id);
		await this.assertBundleGroupsAreUsable(manager, entry.id);
	}

	/**
	 * Turns each component's `group_label_id` into the `group_id` its column holds.
	 *
	 * Read after the groups are synced rather than from the payload, because an update is partial
	 * in both directions: a request may add candidates to a group it is not resending, and one
	 * that resends `bundle_groups` may have just removed the group a component still names. Only
	 * the live rows know which groups the bundle has by the time the components are written.
	 */
	private async resolveComponentGroups(
		manager: EntityManager,
		product_id: number,
		items: ProductBundleItemType[],
	): Promise<ResolvedBundleItem[]> {
		const needsGroup = items.some((item) => item.group_label_id);

		if (!needsGroup) {
			return items.map((item) => ({ ...item, group_id: null }));
		}

		const groups = await manager
			.getRepository(ProductBundleGroupEntity)
			.find({ where: { product_id } });

		const byLabel = new Map(
			groups.map((group) => [group.label_id, group.id]),
		);

		return items.map((item) => {
			if (!item.group_label_id) {
				return { ...item, group_id: null };
			}

			const group_id = byLabel.get(item.group_label_id);

			if (!group_id) {
				throw new CustomError(
					422,
					lang('product.error.bundle_group_unknown'),
				);
			}

			return { ...item, group_id };
		});
	}

	/**
	 * The one rule that spans a group and its candidates, and so belongs to neither alone.
	 *
	 * A group takes exactly one of its candidates, so it needs **two** to be a choice at all. With
	 * one it is a component that is always included wearing a prompt, and with none a question
	 * with no answers - both reachable only through a payload that removed candidates, or created
	 * the group and never filled it.
	 *
	 * Read back from the rows just written for the reason `assertBundleIsComposed` gives: an
	 * update is partial, and a payload that carries only half of the pair leaves the other half
	 * where it was.
	 *
	 * The label term is loaded so the failure can name the group. A bundle offering three
	 * choices otherwise reports which rule broke without saying where.
	 */
	private async assertBundleGroupsAreUsable(
		manager: EntityManager,
		product_id: number,
	): Promise<void> {
		const groups = await manager
			.getRepository(ProductBundleGroupEntity)
			.find({
				where: { product_id },
				relations: { items: true, label: { contents: true } },
			});

		for (const group of groups) {
			const candidates = (group.items ?? []).filter(
				(item) => item.deleted_at === null,
			).length;

			const name =
				group.label?.contents?.[0]?.value ?? String(group.label_id);

			if (candidates < BUNDLE_GROUP_MINIMUM_CANDIDATES) {
				throw new CustomError(
					422,
					lang('product.validation.bundle_group_too_few', {
						group: name,
					}),
				);
			}
		}
	}

	/**
	 * No nested bundles, and no bundle that contains itself.
	 *
	 * A component pointing at another bundle's variant creates a cycle no constraint can detect:
	 * the order line explodes a bundle into one child per component, and a child that is itself
	 * a bundle would have to explode again, with nothing to stop it. Rejected at the write
	 * instead, which is the only place the whole graph is in reach.
	 */
	private async assertComponents(
		manager: EntityManager,
		entry: ProductEntity,
		items: ProductBundleItemType[],
	): Promise<void> {
		if (items.length === 0) {
			return;
		}

		const variantIds = Array.from(
			new Set(items.map((item) => item.variant_id)),
		);

		const variants = await manager
			.getRepository(ProductVariantEntity)
			.find({
				where: { id: In(variantIds) },
				relations: { product: true },
			});

		if (variants.length !== variantIds.length) {
			throw new CustomError(
				422,
				lang('product.validation.invalid_bundle_item'),
			);
		}

		for (const variant of variants) {
			if (variant.product_id === entry.id) {
				throw new CustomError(
					422,
					lang('product.error.bundle_self_reference'),
				);
			}

			if (
				variant.product?.composition === ProductCompositionEnum.BUNDLE
			) {
				throw new CustomError(422, lang('product.error.bundle_nested'));
			}
		}
	}

	/**
	 * A bundle has to be more than one thing, or it is a product wearing a bundle's clothes.
	 *
	 * Counted in units a customer ends up with rather than in components, so a single component
	 * with `quantity: 2` - a two-pack - qualifies where the same component alone does not.
	 *
	 * **Only what the customer cannot decline counts.** The floor has to hold for the least the
	 * customer can walk away with, so an optional component is out - it can be left unticked -
	 * and so is a candidate: the group guarantees *a* candidate is taken, not that one in
	 * particular, and their quantities may differ - a bundle whose whole content is one choice is
	 * a single product with a decision attached.
	 *
	 * Read back from the rows just written instead of from the payload: an update is partial,
	 * so a payload that omits `bundle_items` leaves the existing components in place and only
	 * the table knows what the bundle now holds.
	 */
	private async assertBundleIsComposed(
		manager: EntityManager,
		product_id: number,
	): Promise<void> {
		const includedUnits = await manager
			.getRepository(ProductBundleItemEntity)
			.createQueryBuilder('item')
			.select('COALESCE(SUM(item.quantity), 0)', 'total')
			.where('item.product_id = :product_id', { product_id })
			.andWhere('item.is_optional = false')
			.andWhere('item.group_id IS NULL')
			.getRawOne<{ total: string }>();

		if (Number(includedUnits?.total ?? 0) < BUNDLE_MINIMUM_UNITS) {
			throw new CustomError(
				422,
				lang('product.validation.bundle_composition_too_small'),
			);
		}
	}

	/**
	 * Turns payload variants into rows the repository can write, by resolving each axis value
	 * against the `variant`-scoped definitions of the product's categories.
	 */
	private async resolveVariants(
		variants: ValidatorOutput<ProductValidator, 'create'>['variants'],
		categoryIds: number[],
		composition: ProductComposition,
	): Promise<ResolvedVariant[]> {
		const definitions =
			await productCategoryAttributeService.resolveDefinitionsByLabel(
				categoryIds,
				ProductCategoryAttributeScopeEnum.VARIANT,
				{ assertScopeAgreement: true },
			);

		/*
		 * A bundle carries exactly one variant, the header line its components hang off, and it
		 * has no siblings - so an axis meant to tell siblings apart has nothing to distinguish
		 * and is not asked for. Values still resolve if a caller sends any; only the demand for
		 * the required ones is lifted, which would otherwise make a bundle unsavable in any
		 * category declaring one, with nothing an editor could supply.
		 */
		const isBundle = composition === ProductCompositionEnum.BUNDLE;

		return variants.map((variant) => {
			/*
			 * Per variant, not per product: a required axis is what tells siblings apart, so
			 * every one of them has to state it or the set is ambiguous.
			 */
			if (!isBundle) {
				this.assertRequiredSupplied(definitions, variant.attributes);
			}

			return {
				...variant,
				attributes: variant.attributes?.map((value) =>
					this.resolveAttributeValue(value, definitions),
				),
			};
		});
	}

	/**
	 * Every definition marked `is_required` has to come back with a value.
	 *
	 * The row-level checks in `resolveAttributeValue` can only judge the values a payload *does*
	 * carry; a required attribute the caller simply left out has no row for them to see. So the
	 * set is checked against the definitions it was resolved from, which is also the only place
	 * that knows which of them were required.
	 *
	 * Named by its label rather than its id - the message reaches an editor, and the first
	 * translation the term carries is the closest thing to a name available here.
	 */
	private assertRequiredSupplied(
		definitions: Map<number, ProductCategoryAttributeEntity>,
		values: ProductAttributeType[] | undefined,
	): void {
		const supplied = new Set(
			(values ?? []).map((value) => value.attribute_label_id),
		);

		for (const [labelId, definition] of definitions) {
			if (!definition.is_required || supplied.has(labelId)) {
				continue;
			}

			throw new CustomError(
				422,
				lang('product.error.attribute_required', {
					attribute: attributeLabelName(definition),
				}),
			);
		}
	}

	private async resolveAttributeValues(
		values: ProductAttributeType[],
		categoryIds: number[],
		scope: typeof ProductCategoryAttributeScopeEnum.PRODUCT,
	): Promise<ResolvedAttributeValue[]> {
		const definitions =
			await productCategoryAttributeService.resolveDefinitionsByLabel(
				categoryIds,
				scope,
				{ assertScopeAgreement: true },
			);

		this.assertRequiredSupplied(definitions, values);

		return values.map((value) =>
			this.resolveAttributeValue(value, definitions),
		);
	}

	/**
	 * One recorded value, checked against the definition that governs its label and normalized.
	 *
	 * Three things happen here and nowhere else:
	 *
	 * - the label has to be one the product's categories declare, so a value cannot be recorded
	 *   against a form field that was never offered;
	 * - a term-backed value has to be on the definition's option list, which spans three tables
	 *   and is the second half of the invariant `product_category_attribute_option` cannot hold;
	 * - `value_base` is produced by `toBaseUnit`, once, on write - converting at read time would
	 *   put arithmetic between a range filter and its index.
	 */
	private resolveAttributeValue(
		value: ProductAttributeType,
		definitions: Map<number, ProductCategoryAttributeEntity>,
	): ResolvedAttributeValue {
		const definition = definitions.get(value.attribute_label_id);

		if (!definition) {
			throw new CustomError(
				422,
				lang('product.error.attribute_not_declared'),
			);
		}

		const expected = {
			[ProductCategoryAttributeValueTypeEnum.TERM]: value.value_term_id,
			[ProductCategoryAttributeValueTypeEnum.NUMBER]: value.value_numeric,
			[ProductCategoryAttributeValueTypeEnum.STRING]: value.value_text,
			[ProductCategoryAttributeValueTypeEnum.BOOLEAN]:
				value.value_boolean,
		}[definition.value_type];

		if (expected === undefined || expected === null) {
			throw new CustomError(
				422,
				lang('product.error.attribute_value_type_mismatch'),
			);
		}

		if (
			definition.value_type === ProductCategoryAttributeValueTypeEnum.TERM
		) {
			const admissible = (definition.options ?? []).map(
				(option) => option.term_id,
			);

			if (!admissible.includes(value.value_term_id as number)) {
				throw new CustomError(
					422,
					lang('product.error.attribute_value_not_admissible'),
				);
			}

			return { ...value, value_base: null };
		}

		if (
			definition.value_type !==
			ProductCategoryAttributeValueTypeEnum.NUMBER
		) {
			return { ...value, value_base: null };
		}

		const numeric = value.value_numeric as number;

		// The bounds are quoted in the definition's own unit, like the value they bound, so
		// they are compared before the conversion rather than after it
		if (
			(definition.min_value !== null && numeric < definition.min_value) ||
			(definition.max_value !== null && numeric > definition.max_value)
		) {
			throw new CustomError(
				422,
				lang('product.error.attribute_value_out_of_range'),
			);
		}

		return {
			...value,
			value_base: toBaseUnit(numeric, definition.unit),
		};
	}

	public async updateWorkflow(
		entry: ProductEntity,
		workflow: ProductWorkflow,
	): Promise<void> {
		assertValidStatusTransition(
			WORKFLOW_TRANSITIONS,
			entry.workflow,
			workflow,
		);

		entry.workflow = workflow;

		await this.update(entry);
	}

	/**
	 * Moves a product onto the `sale_status` its timestamps imply. Called by the recompute cron for
	 * rows whose deadline has passed since the last pass; the write paths compute the same value
	 * inline, so this only ever finds products time has moved.
	 *
	 * Returns whether anything changed, so the cron can report a count rather than a pass.
	 */
	public async recomputeSaleStatus(entry: ProductEntity): Promise<boolean> {
		const resolved = this.resolveSaleStatus(entry);

		if (resolved === entry.sale_status) {
			return false;
		}

		entry.sale_status = resolved;

		await this.update(entry);

		return true;
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<ProductEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * The category and every category beneath it, as ids.
	 *
	 * Every `category_id` filter resolves through here - this service's listings, the storefront's,
	 * and `ProductVariantService`'s - so "in this category" means the same thing to all of them: a
	 * catalog tree is three levels deep and a shopper filtering on the top one expects the whole
	 * branch. Public for that last caller, which sits in a sibling module of the same feature.
	 */
	public async resolveCategorySubtree(
		category_id: number,
	): Promise<number[]> {
		const treeRepository =
			RepositoryAbstract.getTreeRepository(CategoryEntity);

		const category = await treeRepository.findOneOrFail({
			where: { id: category_id },
		});

		const descendants = await treeRepository.findDescendants(category);

		return descendants.map((descendant) => descendant.id);
	}

	/**
	 * The child branches of a product, read one query per branch.
	 *
	 * Not joined onto the main query: variants, option groups, bundle components, availabilities
	 * and attributes are five independent to-many relations, and joining them together
	 * multiplies into their product - four variants against three option groups against six
	 * attributes is seventy-two rows for one product, every column repeated in each.
	 */
	private async attachBranches(
		entry: ProductEntity,
		options: { withDeleted: boolean },
	): Promise<ProductEntity> {
		const product_id = entry.id;
		const withDeleted = options.withDeleted;

		const [
			variants,
			attributes,
			availabilities,
			optionGroups,
			bundleGroups,
			bundleItems,
		] = await Promise.all([
			dataSource.getRepository(ProductVariantEntity).find({
				where: { product_id },
				relations: { prices: true, attributes: true },
				order: { position: 'ASC', id: 'ASC' },
				withDeleted,
			}),
			ProductAttributeRepository.find({
				where: { product_id },
				withDeleted,
			}),
			dataSource.getRepository(ProductAvailabilityEntity).find({
				where: { product_id },
				order: { day_of_week: 'ASC', starts_at: 'ASC' },
			}),
			/*
			 * The wording comes with the ids on both levels, the way `findForCategories` brings
			 * it behind `resolve`: a group and its answers are `term` references and nothing
			 * else, so an editor handed the ids alone has a control it cannot draw and no way
			 * to resolve them but one request per row.
			 *
			 * Every translation, not the request's own - the dashboard edits a product under
			 * all of them at once and picks per language at render time.
			 *
			 * `options` is ordered explicitly. Insertion order matches `position` only until a
			 * group is reordered, after which the editor would draw the answers shuffled and
			 * then re-stamp `position` from what it drew.
			 */
			dataSource.getRepository(ProductOptionGroupEntity).find({
				where: { product_id },
				relations: {
					label: { contents: true },
					options: { label: { contents: true }, prices: true },
				},
				order: {
					position: 'ASC',
					id: 'ASC',
					options: {
						position: 'ASC',
						id: 'ASC',
						// The deltas have no position of their own, so a market is named by its
						// code - an unordered read hands a multi-market answer back in a
						// different order each time, and the editor redraws its rows to match.
						prices: { currency: 'ASC' },
					},
				},
			}),
			/*
			 * The deltas come along, unlike the component's variant, which the dashboard resolves
			 * itself through `GET /product-variants`. They are the bundle form's own state: an
			 * edit reopened without them shows every delta blank, and the next save writes that
			 * blank back.
			 */
			/*
			 * The groups come back flat beside the components rather than around them, which is
			 * the shape the payload takes too. A component names its group by `group_id`, and the
			 * label term rides along so the editor can draw the prompt without a second read.
			 */
			dataSource.getRepository(ProductBundleGroupEntity).find({
				where: { product_id },
				relations: { label: { contents: true } },
				order: { position: 'ASC', id: 'ASC' },
			}),
			dataSource.getRepository(ProductBundleItemEntity).find({
				where: { product_id },
				relations: { prices: true },
				order: {
					position: 'ASC',
					id: 'ASC',
					prices: { currency: 'ASC' },
				},
			}),
		]);

		entry.variants = variants;
		entry.attributes = attributes;
		entry.availabilities = availabilities;
		entry.option_groups = optionGroups;
		entry.bundle_groups = bundleGroups;
		entry.bundle_items = bundleItems;

		return entry;
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 *
	 * An omitted `language` means every translation, not the request's own - the dashboard edits
	 * all of them at once and has no other way to ask for them.
	 */
	public async getEntryData(data: {
		id: number;
		language?: string;
		withDeleted: boolean;
	}) {
		const query = this.repository
			.createQuery()
			.select([
				'product.id',
				'product.workflow',
				'product.sale_status',
				'product.type',
				'product.composition',
				'product.unit',
				'product.vat_category',
				'product.available_from',
				'product.available_until',
				'product.discontinued_at',
				'product.details',
				'product.brand_id',
				'product.created_at',
				'product.updated_at',
				'product.deleted_at',

				'content.language',
				'content.slug',
				'content.label',
				'content.description',
				'content.meta',

				'brand.id',
				'brand.name',

				'category.category_id',
				'tag.tag_id',

				// The wording behind each link, so a form seeded from this row shows names
				// rather than the bare ids it stores
				'category_row.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',

				'tag_row.id',
				'tag_content.id',
				'tag_content.language',
				'tag_content.value',
			])
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.joinAndSelect('product.brand', 'brand', 'LEFT')
			/*
			 * The link joins are pinned to live rows by hand because `withDeleted` reaches
			 * them too: it exists so an admin can read a soft-deleted *product*, but TypeORM
			 * applies it to every joined relation, which brings back links unlinked in earlier
			 * edits. The form seeds itself from these rows, so a resurrected link reads as a
			 * removal that did not save.
			 */
			.joinAndSelect(
				'product.categories',
				'category',
				'LEFT',
				'category.deleted_at IS NULL',
			)
			.joinAndSelect(
				'product.tags',
				'tag',
				'LEFT',
				'tag.deleted_at IS NULL',
			)
			.join('category.category', 'category_row', 'LEFT')
			.join('tag.tag', 'tag_row', 'LEFT');

		if (data.language) {
			query
				.joinAndSelect(
					'product.contents',
					'content',
					'INNER',
					'content.language = :language',
					{ language: data.language },
				)
				.join(
					'category_row.contents',
					'category_content',
					'LEFT',
					'category_content.language = :language',
				)
				.join(
					'tag_row.contents',
					'tag_content',
					'LEFT',
					'tag_content.language = :language',
				);
		} else {
			query
				.joinAndSelect('product.contents', 'content', 'LEFT')
				.join('category_row.contents', 'category_content', 'LEFT')
				.join('tag_row.contents', 'tag_content', 'LEFT');
		}

		const entry = await query.firstOrFail();

		return this.attachBranches(entry, { withDeleted: data.withDeleted });
	}

	/**
	 * @description Used in `publicRead` from controller - the anonymous surface.
	 *
	 * Keyed on the content slug, which is the whole public address (`/products/<slug>`) - the
	 * category a product is filed under does not appear in it. Only the sellable
	 * window is reachable, so a draft or a withdrawn product answers 404 to a visitor rather
	 * than leaking its existence through a different status code.
	 */
	public resolvePublicRef(
		slug: string,
		language: string,
	): Promise<ProductEntity> {
		return this.repository
			.createQuery()
			.select(['product.id'])
			.join(
				'product.contents',
				'content',
				'INNER',
				'content.language = :language AND content.slug = :slug',
				{ language, slug },
			)
			.filterBySellable(true)
			.firstOrFail();
	}

	/**
	 * Attaches every live variant of each listed product, named.
	 *
	 * A variant has no label column - what tells one from its siblings is its axis values in
	 * `product_variant_attribute`, so the wording has to be resolved through `term_content` before
	 * a card can say "Small". Only the requested language is joined: the dashboard reads every
	 * translation at once, a storefront reads exactly one.
	 *
	 * `language` is optional on the validator and filled in by the controller. Were it left unset
	 * the term-content joins would match nothing and the axes would come back unnamed - the same
	 * failure the listing's own `INNER` content join already has, not a quieter one.
	 *
	 * A second query rather than more joins on the listing itself. That statement already
	 * multiplies its rows by the to-many `product_category` join; adding
	 * `variants x prices x attributes x contents` on top turns a page of twelve into a cartesian
	 * product. `attachBranches` splits the single read for the same reason.
	 *
	 * This is the listing's only variant source. The pinned `is_default` join it used to carry was
	 * multiplying the listing's rows to produce a payload this then replaced wholesale; a card
	 * reads the default off `is_default` in the set instead. `filterByTerm` never used that alias
	 * either - it matches SKUs through its own `EXISTS` subquery, precisely so a product is found
	 * by any of its codes rather than only its default one.
	 */
	private async attachVariants<
		T extends { id: number; categories?: { category_id: number }[] },
	>(entries: T[], language: string | undefined): Promise<WithVariants<T>[]> {
		if (entries.length === 0) {
			return [];
		}

		const variants = await dataSource
			.getRepository(ProductVariantEntity)
			.createQueryBuilder('variant')
			.leftJoinAndSelect(
				'variant.prices',
				'price',
				'price.deleted_at IS NULL',
			)
			.leftJoinAndSelect(
				'variant.attributes',
				'attribute',
				'attribute.deleted_at IS NULL',
			)
			.leftJoinAndSelect('attribute.attribute_label', 'attribute_label')
			.leftJoinAndSelect(
				'attribute_label.contents',
				'attribute_label_content',
				'attribute_label_content.language = :language',
			)
			.leftJoinAndSelect('attribute.attribute_value', 'attribute_value')
			.leftJoinAndSelect(
				'attribute_value.contents',
				'attribute_value_content',
				'attribute_value_content.language = :language',
			)
			/*
			 * Projected, never the whole entity. A variant row carries `cost_price`, and its prices
			 * carry `min_price` - what the product costs to buy and the floor a discount may not
			 * resolve below. Neither belongs on a route with no policy, and the stock knobs say more
			 * about the warehouse than a card needs. The joined rows' primary keys are selected
			 * because TypeORM cannot map a narrowed join without them.
			 */
			.select([
				'variant.id',
				'variant.product_id',
				'variant.sku',
				'variant.position',
				'variant.is_default',

				'price.id',
				'price.currency',
				'price.sale_price',
				'price.reference_price',

				'attribute.id',
				'attribute.attribute_label_id',
				'attribute.value_term_id',
				'attribute.value_numeric',
				'attribute.value_text',
				'attribute.value_boolean',

				'attribute_label.id',
				'attribute_label_content.id',
				'attribute_label_content.language',
				'attribute_label_content.value',

				'attribute_value.id',
				'attribute_value_content.id',
				'attribute_value_content.language',
				'attribute_value_content.value',
			])
			.where('variant.product_id IN (:...productIds)', {
				productIds: entries.map((entry) => entry.id),
			})
			.setParameter('language', language)
			.orderBy('variant.position', 'ASC')
			.addOrderBy('variant.id', 'ASC')
			.getMany();

		/*
		 * The axes are ordered by their definition's `sort_order`, over the union of every category
		 * on the page - one resolve, not one per product. Insertion order is not usable here: it
		 * would read "Blue Large" on one row and "Large Blue" on the next, from the same two axes.
		 */
		const categoryIds = [
			...new Set(
				entries.flatMap(
					(entry) =>
						entry.categories?.map((link) => link.category_id) ?? [],
				),
			),
		];

		const definitions = categoryIds.length
			? await productCategoryAttributeService.resolveDefinitionsByLabel(
					categoryIds,
					ProductCategoryAttributeScopeEnum.VARIANT,
				)
			: new Map<number, ProductCategoryAttributeEntity>();

		const sortOrderOf = (label_id: number): number =>
			definitions.get(label_id)?.sort_order ?? Number.MAX_SAFE_INTEGER;

		/*
		 * A variant's own photographs, filed under the `product_variant` section - the picture a
		 * card shows when the catalog is listing variants rather than products. Resolved for the
		 * whole page in one call, the way the products' own covers are.
		 *
		 * A variant with no gallery answers `null` and the caller falls back to its product's
		 * cover; the fallback is the storefront's to make, not this method's, because which way
		 * it runs depends on what the grid is listing.
		 */
		const variantCovers = await resolveTargetImages(
			ProductVariantEntity.NAME,
			TargetImageTypeEnum.GALLERY,
			variants.map((variant) => variant.id),
		);

		const byProduct = new Map<
			number,
			WithCoverImage<ProductVariantEntity>[]
		>();

		for (const variant of variants) {
			variant.attributes?.sort(
				(left, right) =>
					sortOrderOf(left.attribute_label_id) -
						sortOrderOf(right.attribute_label_id) ||
					left.attribute_label_id - right.attribute_label_id,
			);

			/*
			 * The definition's quoting, copied onto the axis the same way
			 * `attachPublicAttributes` copies it onto a product attribute. A numeric axis is a
			 * bare `15` without it, and a page listing product attributes and variant axes in one
			 * table would quote half its rows and not the other half. Costs nothing - the
			 * definitions are already resolved above, for the sort.
			 */
			for (const axis of variant.attributes ?? []) {
				const definition = definitions.get(axis.attribute_label_id);

				Object.assign(axis, {
					unit: definition?.unit ?? null,
					suffix: definition?.suffix ?? null,
				});
			}

			const withCover: WithCoverImage<ProductVariantEntity> = {
				...variant,
				cover_image: variantCovers.get(variant.id) ?? null,
			};

			const list = byProduct.get(variant.product_id);

			if (list) {
				list.push(withCover);
			} else {
				byProduct.set(variant.product_id, [withCover]);
			}
		}

		return entries.map((entry) => ({
			...entry,
			variants: byProduct.get(entry.id) ?? [],
		}));
	}

	/**
	 * Adds the VAT-inclusive figures a storefront quotes - `sale_price_gross` and
	 * `reference_price_gross` - beside the stored prices, which exclude VAT.
	 *
	 * Computed here rather than on the client because the client knows neither the rates, which are
	 * deployment configuration, nor - for a bundle - how the price splits across components taxed
	 * at different rates.
	 *
	 * A simple product is taxed at its own `vat_category`. A bundle's own class is unused
	 * (`product.md` §8.4): its price is apportioned across the **kit** - the components that are
	 * always included, plus each group's preselected candidate or, lacking one, its first - pro-rata
	 * by standalone price in that currency, and each share taxed at its component's rate. That is
	 * `CartPricingService.buildBundle`'s arithmetic over the configuration the headline price
	 * describes; optional extras are left out because the headline does not include them. A
	 * reference price is scaled by the same ratio, having no split of its own.
	 *
	 * VAT is rounded per share, as the cart rounds per line, so the gross figure is the one the cart
	 * will charge. Bundles cost two extra reads for the whole page; a page of simple products costs
	 * none.
	 */
	private async attachGrossPrices<
		T extends {
			id: number;
			composition: ProductComposition;
			vat_category: Parameters<typeof resolveVatRate>[0];
			variants: {
				prices?: {
					currency: string;
					sale_price: number | null;
					reference_price: number | null;
				}[];
			}[];
		},
	>(entries: T[]): Promise<T[]> {
		const bundleIds = entries
			.filter(
				(entry) => entry.composition === ProductCompositionEnum.BUNDLE,
			)
			.map((entry) => entry.id);

		const kits = new Map<number, { variant_id: number; units: number }[]>();

		if (bundleIds.length > 0) {
			const compositions =
				await productBundleSelectionService.loadComposition(bundleIds);

			for (const [bundleId, composition] of compositions) {
				const picked = [...composition.candidatesByGroup.values()]
					.map(
						(candidates) =>
							candidates.find((item) => item.is_default) ??
							candidates[0],
					)
					.filter((item) => item !== undefined);

				kits.set(
					bundleId,
					[...composition.mandatory, ...picked].map((item) => ({
						variant_id: item.variant_id,
						units: Number(item.quantity),
					})),
				);
			}
		}

		const componentVariantIds = [
			...new Set(
				[...kits.values()].flatMap((kit) =>
					kit.map((part) => part.variant_id),
				),
			),
		];

		const componentVariants =
			componentVariantIds.length === 0
				? []
				: await dataSource
						.getRepository(ProductVariantEntity)
						.createQueryBuilder('variant')
						.leftJoinAndSelect(
							'variant.prices',
							'price',
							'price.deleted_at IS NULL',
						)
						.leftJoinAndSelect('variant.product', 'product')
						.select([
							'variant.id',
							'price.id',
							'price.currency',
							'price.sale_price',
							'product.id',
							'product.vat_category',
						])
						.where('variant.id IN (:...ids)', {
							ids: componentVariantIds,
						})
						.getMany();

		const componentById = new Map(
			componentVariants.map((variant) => [variant.id, variant]),
		);

		const grossOf = (entry: T, currency: string, sale: number): number => {
			const kit = kits.get(entry.id);

			if (!kit || kit.length === 0) {
				const rate = resolveVatRate(entry.vat_category);

				return roundMoney(sale + roundMoney((sale * rate) / 100));
			}

			const parts = kit.map((part) => {
				const component = componentById.get(part.variant_id);
				const standalone = Number(
					component?.prices?.find(
						(price) => price.currency === currency,
					)?.sale_price ?? 0,
				);

				return {
					weight: standalone * part.units,
					rate: resolveVatRate(
						component?.product?.vat_category ?? 'standard',
					),
				};
			});

			const shares = apportion(
				sale,
				parts.map((part) => part.weight),
			);

			const vat = shares.reduce(
				(sum, share, index) =>
					sum + roundMoney((share * parts[index].rate) / 100),
				0,
			);

			return roundMoney(sale + vat);
		};

		for (const entry of entries) {
			for (const variant of entry.variants) {
				for (const price of variant.prices ?? []) {
					const sale =
						price.sale_price === null
							? null
							: Number(price.sale_price);
					const reference =
						price.reference_price === null
							? null
							: Number(price.reference_price);
					const saleGross =
						sale === null
							? null
							: grossOf(entry, price.currency, sale);

					Object.assign(price, {
						sale_price_gross: saleGross,
						reference_price_gross:
							reference === null
								? null
								: sale && saleGross !== null
									? roundMoney((reference * saleGross) / sale)
									: grossOf(entry, price.currency, reference),
					});
				}
			}
		}

		return entries;
	}

	/**
	 * Replaces the product's own attribute rows with the named, ordered set a spec table is drawn
	 * from.
	 *
	 * `attachBranches` already loaded them, but for the dashboard: bare ids, because an editor
	 * resolves its wording through the `resolve` endpoint it drew the form from. A visitor has no
	 * such form, so `attribute_label` and `attribute_value` are joined through `term_content` here
	 * - the same treatment `attachVariants` gives an axis, for the same reason.
	 *
	 * Only the served language is joined. A row whose terms carry no wording in it comes back
	 * unnamed rather than in another language, and the storefront drops it: half a spec line in
	 * Romanian on an English page is worse than one line fewer.
	 *
	 * Ordered by the definition's `sort_order` over the union of the product's categories, so the
	 * table reads the way the category declares it rather than in insertion order - which would
	 * shuffle the moment an attribute is re-saved.
	 */
	private async attachPublicAttributes<
		T extends { id: number; categories?: { category_id: number }[] },
	>(
		entry: T,
		language: string | undefined,
	): Promise<WithPublicAttributes<T>> {
		const rows = await dataSource
			.getRepository(ProductAttributeEntity)
			.createQueryBuilder('attribute')
			.leftJoinAndSelect('attribute.attribute_label', 'attribute_label')
			.leftJoinAndSelect(
				'attribute_label.contents',
				'attribute_label_content',
				'attribute_label_content.language = :language',
			)
			.leftJoinAndSelect('attribute.attribute_value', 'attribute_value')
			.leftJoinAndSelect(
				'attribute_value.contents',
				'attribute_value_content',
				'attribute_value_content.language = :language',
			)
			/*
			 * Projected, like the variants'. `value_base` is the figure normalized for range
			 * filters - a second copy of `value_numeric` in a unit nothing displays - and the
			 * timestamps say when an operator last edited the row, which is not the visitor's
			 * business. The joined rows' primary keys are selected because TypeORM cannot map a
			 * narrowed join without them.
			 */
			.select([
				'attribute.id',
				'attribute.attribute_label_id',
				'attribute.value_term_id',
				'attribute.value_numeric',
				'attribute.value_text',
				'attribute.value_boolean',

				'attribute_label.id',
				'attribute_label_content.id',
				'attribute_label_content.language',
				'attribute_label_content.value',

				'attribute_value.id',
				'attribute_value_content.id',
				'attribute_value_content.language',
				'attribute_value_content.value',
			])
			.where('attribute.product_id = :productId', { productId: entry.id })
			.setParameter('language', language)
			.getMany();

		const categoryIds = [
			...new Set(entry.categories?.map((link) => link.category_id) ?? []),
		];

		const definitions = categoryIds.length
			? await productCategoryAttributeService.resolveDefinitionsByLabel(
					categoryIds,
					ProductCategoryAttributeScopeEnum.PRODUCT,
				)
			: new Map<number, ProductCategoryAttributeEntity>();

		const sortOrderOf = (label_id: number): number =>
			definitions.get(label_id)?.sort_order ?? Number.MAX_SAFE_INTEGER;

		const attributes: PublicProductAttribute[] = rows
			.map((row) => {
				const definition = definitions.get(row.attribute_label_id);

				return {
					...row,
					unit: definition?.unit ?? null,
					suffix: definition?.suffix ?? null,
				};
			})
			.sort(
				(left, right) =>
					sortOrderOf(left.attribute_label_id) -
						sortOrderOf(right.attribute_label_id) ||
					left.attribute_label_id - right.attribute_label_id ||
					left.id - right.id,
			);

		return { ...entry, attributes };
	}

	/**
	 * Attaches the whole gallery - the product's own pictures, and each variant's.
	 *
	 * The detail page's counterpart to `attachCoverImages`, and only ever called from the public
	 * read: a listing shows one picture per card and must not drag a dozen down the wire for each
	 * of twelve products. Two calls, one per section, each batched over its ids.
	 *
	 * A product or variant with no gallery gets `[]` rather than being left without the key, for
	 * the reason `cover_image` is always present: a client must not have to tell "no pictures"
	 * apart from "no image feature installed". With nothing registered every gallery is empty,
	 * which is what an uninstalled `image` looks like.
	 */
	private async attachPublicGalleries<
		T extends { id: number; variants?: { id: number }[] },
	>(entry: T): Promise<WithGallery<T>> {
		const variants = entry.variants ?? [];

		const [productImages, variantImages] = await Promise.all([
			resolveTargetImageLists(
				ProductEntity.NAME,
				TargetImageTypeEnum.GALLERY,
				[entry.id],
			),
			resolveTargetImageLists(
				ProductVariantEntity.NAME,
				TargetImageTypeEnum.GALLERY,
				variants.map((variant) => variant.id),
			),
		]);

		return {
			...entry,
			images: productImages.get(entry.id) ?? [],
			variants: variants.map((variant) => ({
				...variant,
				images: variantImages.get(variant.id) ?? [],
			})),
		};
	}

	/**
	 * Attaches each product's cover image, when the deployment has something to answer with.
	 *
	 * Asked of the registry in `target-image.config.ts` rather than of the `image` feature,
	 * which is optional here. With no provider registered - a deployment without `image`, or the
	 * `test` environment, where bootstrap does not run - every product answers `null`. The key
	 * stays present either way: a client must not have to tell "no image" apart from "no image
	 * feature".
	 */
	private async attachCoverImages<T extends { id: number }>(
		entries: T[],
	): Promise<WithCoverImage<T>[]> {
		if (entries.length === 0) {
			return [];
		}

		const covers = await resolveTargetImages(
			ProductEntity.NAME,
			TargetImageTypeEnum.GALLERY,
			entries.map((entry) => entry.id),
		);

		return entries.map((entry) => ({
			...entry,
			cover_image: covers.get(entry.id) ?? null,
		}));
	}

	/**
	 * @description Used in `publicRead` from controller, behind the cache.
	 *
	 * Keyed by id rather than slug on purpose: `cleanEntityCache` invalidates by the
	 * `<entity>:<id>*` prefix, so a slug-keyed entry would survive an edit until its TTL.
	 * Resolving the slug first (`resolvePublicRef`) also keeps the sellable window out of the
	 * cached value, which moves without the payload changing.
	 */
	public async getPublicEntryById(id: number, language: string) {
		const entry = await this.repository
			.createQuery()
			.select([
				'product.id',
				'product.sale_status',
				'product.type',
				'product.composition',
				'product.unit',
				'product.vat_category',
				'product.available_from',
				'product.available_until',
				'product.created_at',
				'product.updated_at',

				'content.language',
				'content.slug',
				'content.label',
				'content.description',
				'content.meta',

				'brand.id',
				'brand.name',

				'category.category_id',
				'category_row.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',
				'category_content.slug',

				'tag.tag_id',
				'tag_row.id',
				'tag_content.id',
				'tag_content.language',
				'tag_content.value',
			])
			.filterById(id)
			.joinAndSelect(
				'product.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language },
			)
			.joinAndSelect('product.brand', 'brand', 'LEFT')
			.joinAndSelect('product.categories', 'category', 'LEFT')
			.joinAndSelect('category.category', 'category_row', 'LEFT')
			.joinAndSelect(
				'category_row.contents',
				'category_content',
				'LEFT',
				'category_content.language = :language',
			)
			.joinAndSelect('product.tags', 'tag', 'LEFT')
			.joinAndSelect('tag.tag', 'tag_row', 'LEFT')
			.joinAndSelect(
				'tag_row.contents',
				'tag_content',
				'LEFT',
				'tag_content.language = :language',
			)
			.firstOrFail();

		await this.attachBranches(entry, { withDeleted: false });

		/*
		 * The variants `attachBranches` loaded are replaced by the projected, named set.
		 *
		 * Two reasons, both of which apply only here. A branch read for the dashboard carries
		 * `cost_price` and `min_price` - what the product costs to buy and the floor a discount may
		 * not resolve below - and neither belongs on a route with no policy. And a variant has no
		 * label of its own, so a page offering a choice between them needs the axis values resolved
		 * through `term_content`, which the dashboard's read has no use for and does not join.
		 */
		const [entryWithVariants] = await this.attachGrossPrices(
			await this.attachVariants([entry], language),
		);

		const entryWithAttributes = await this.attachPublicAttributes(
			entryWithVariants,
			language,
		);

		/*
		 * Replaces the rows `attachBranches` left on the entry, the way the variants above are
		 * replaced and for the same reason: those are the dashboard's shape - every translation of
		 * every prompt, timestamps, soft-delete columns - and a component there is a bare
		 * `variant_id` a storefront cannot draw.
		 */
		const entryWithComposition = await this.attachPublicComposition(
			entryWithAttributes,
			language,
		);

		const [entryWithCover] = await this.attachCoverImages([
			entryWithComposition,
		]);

		return await this.attachPublicGalleries(entryWithCover);
	}

	/**
	 * A bundle's composition, projected for the storefront so a page can offer its choices.
	 *
	 * Built from what `attachBranches` already loaded rather than read again - the groups, their
	 * prompts and the per-currency deltas are all on the entry by the time this runs, so the only
	 * thing missing is what a component *is*: its variant's SKU and prices, and the label of the
	 * product that variant belongs to. That is one query however many components the bundle has.
	 *
	 * A product with no components does none of it. Every simple product takes that path, which is
	 * nearly all of them, so the cost falls only on the reads that need it.
	 *
	 * The prompt is narrowed to the served language here rather than in the join, because the rows
	 * were loaded for the dashboard's sake with every translation on them; picking one from an
	 * array already in memory is cheaper than reading them again.
	 */
	private async attachPublicComposition<
		T extends {
			bundle_groups?: ProductBundleGroupEntity[];
			bundle_items?: ProductBundleItemEntity[];
		},
	>(entry: T, language: string | undefined): Promise<WithComposition<T>> {
		const groups = entry.bundle_groups ?? [];
		const items = entry.bundle_items ?? [];

		if (items.length === 0) {
			return { ...entry, bundle_groups: [], bundle_items: [] };
		}

		const variantIds = [...new Set(items.map((item) => item.variant_id))];

		const variants = await dataSource
			.getRepository(ProductVariantEntity)
			.createQueryBuilder('variant')
			.leftJoinAndSelect(
				'variant.prices',
				'price',
				'price.deleted_at IS NULL',
			)
			.leftJoinAndSelect('variant.product', 'component_product')
			.leftJoinAndSelect(
				'component_product.contents',
				'component_content',
				'component_content.language = :language',
			)
			/*
			 * Projected like every other public read on this route: `cost_price` and `min_price`
			 * describe what the business pays and the floor a discount may not cross, and neither
			 * belongs on a route with no policy. The joined rows' primary keys are selected
			 * because TypeORM cannot map a narrowed join without them.
			 */
			.select([
				'variant.id',
				'variant.sku',
				'variant.product_id',

				'price.id',
				'price.currency',
				'price.sale_price',
				'price.reference_price',

				'component_product.id',
				'component_product.vat_category',
				'component_content.id',
				'component_content.language',
				'component_content.label',
			])
			.where('variant.id IN (:...variantIds)', { variantIds })
			.setParameter('language', language)
			.getMany();

		const variantById = new Map(
			variants.map((variant) => [variant.id, variant]),
		);

		const publicGroups: PublicBundleGroup[] = groups.map((group) => ({
			id: group.id,
			label_id: group.label_id,
			position: group.position,
			label: group.label
				? {
						id: group.label.id,
						contents: (group.label.contents ?? [])
							.filter(
								(content) =>
									language === undefined ||
									content.language === language,
							)
							.map((content) => ({
								language: content.language,
								value: content.value,
							})),
					}
				: null,
		}));

		const publicItems: PublicBundleComponent[] = items.map((item) => {
			const variant = variantById.get(item.variant_id);

			return {
				id: item.id,
				variant_id: item.variant_id,
				// `numeric` with no transformer on this column, so the driver hands it over as a
				// string - a ceiling compared as text would order 10 before 2.
				quantity: Number(item.quantity),
				group_id: item.group_id,
				position: item.position,
				is_optional: item.is_optional,
				is_default: item.is_default,
				prices: (item.prices ?? []).map((price) => ({
					currency: price.currency,
					price_delta: Number(price.price_delta),
				})),
				variant: variant
					? {
							id: variant.id,
							sku: variant.sku,
							prices: (variant.prices ?? []).map((price) => ({
								currency: price.currency,
								sale_price: price.sale_price,
								reference_price: price.reference_price,
							})),
						}
					: null,
				label: variant?.product?.contents?.[0]?.label ?? null,
				// An unresolved component falls back to the standard rate, the same way
				// `resolveVatRate` treats an unknown class: under-quoting VAT is the costly error.
				vat_rate: resolveVatRate(
					variant?.product?.vat_category ?? 'standard',
				),
			};
		});

		return {
			...entry,
			bundle_groups: publicGroups,
			bundle_items: publicItems,
		};
	}

	/**
	 * The catalog listing.
	 *
	 * Facets are one indexed `IN` subquery per facet, `AND`ed. A single `OR`-of-`AND`s cannot
	 * use a composite index leading on the label and degrades to a sequential scan - see
	 * `.claude/rules/product.md` §12.7. Ranges compare `value_base`, which is why the payload's
	 * figures are converted through the definition's unit first.
	 */
	private async applyFacets(
		query: ReturnType<
			ReturnType<typeof getProductRepository>['createQuery']
		>,
		facets: ValidatorOutput<
			ProductValidator,
			'publicFind'
		>['filter']['attribute'],
		categoryIds: number[],
	): Promise<void> {
		if (!facets?.length) {
			return;
		}

		const definitions =
			await productCategoryAttributeService.resolveDefinitionsByLabel(
				categoryIds,
				ProductCategoryAttributeScopeEnum.PRODUCT,
			);

		facets.forEach((facet, index) => {
			const definition = definitions.get(facet.label_id);
			const unit = definition?.unit ?? null;

			const conditions = [
				`facet_value_${index}.attribute_label_id = :facetLabel${index}`,
				`facet_value_${index}.deleted_at IS NULL`,
			];

			const parameters: Record<string, number | number[]> = {
				[`facetLabel${index}`]: facet.label_id,
			};

			if (facet.value_term_id) {
				conditions.push(
					`facet_value_${index}.value_term_id = ANY(:facetTerms${index})`,
				);
				parameters[`facetTerms${index}`] = [...facet.value_term_id];
			}

			if (facet.min !== undefined && facet.min !== null) {
				conditions.push(
					`facet_value_${index}.value_base >= :facetMin${index}`,
				);
				parameters[`facetMin${index}`] = toBaseUnit(facet.min, unit);
			}

			if (facet.max !== undefined && facet.max !== null) {
				conditions.push(
					`facet_value_${index}.value_base <= :facetMax${index}`,
				);
				parameters[`facetMax${index}`] = toBaseUnit(facet.max, unit);
			}

			query.filterRaw(
				`product.id IN (
					SELECT facet_value_${index}.product_id
					FROM product_attribute facet_value_${index}
					WHERE ${conditions.join(' AND ')}
				)`,
				parameters,
			);
		});
	}

	public async findByFilterPublic(
		data: ValidatorOutput<ProductValidator, 'publicFind'>,
	) {
		const query = this.repository
			.createQuery()
			.join(
				'product.contents',
				'content',
				'INNER',
				'content.language = :language',
				{ language: data.filter.language },
			)
			.join('product.brand', 'brand', 'LEFT')
			/*
			 * The listing names each product's categories, which live two relations away
			 * (link row -> category -> translation) and are what its public URL is built
			 * from. The link is to-many, so these joins multiply the raw rows; pagination
			 * survives it because `getManyAndCount` with skip/take resolves the page as a
			 * distinct-id subquery first. The primary keys are selected for the same reason -
			 * without them TypeORM cannot tell the duplicated rows apart.
			 */
			.join(
				'product.categories',
				'product_category',
				'LEFT',
				'product_category.deleted_at IS NULL',
			)
			.join('product_category.category', 'category', 'LEFT')
			.join(
				'category.contents',
				'category_content',
				'LEFT',
				'category_content.language = :language',
			)
			.select([
				'product.id',
				'product.type',
				'product.composition',
				'product.unit',
				'product.vat_category',
				'product.created_at',

				'content.language',
				'content.slug',
				'content.label',
				'content.meta',

				'brand.id',
				'brand.name',
				// The card links the brand; without the slug it cannot build the href
				'brand.slug',

				'product_category.id',
				'product_category.category_id',
				'category.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',
				'category_content.slug',
			])
			.filterBy('product.id', data.filter.id)
			.filterBy('product.brand_id', data.filter.brand_id)
			.filterByTerm(data.filter.term)
			.filterBySellable(true);

		const categoryIds = data.filter.category_id
			? await this.resolveCategorySubtree(data.filter.category_id)
			: [];

		if (categoryIds.length) {
			// Its own join: `product_category` above is a LEFT join feeding the label, and
			// narrowing it would turn every listed product into a category match
			query
				.join('product.categories', 'category_filter', 'INNER')
				.filterRaw('category_filter.category_id IN (:...categoryIds)', {
					categoryIds,
				});
		}

		if (data.filter.tag_id?.length) {
			query
				.join('product.tags', 'tag', 'INNER')
				.filterBy('tag.tag_id', [...data.filter.tag_id], 'IN');
		}

		if (data.filter.exclude_id) {
			query.filterBy('product.id', data.filter.exclude_id, '!=');
		}

		await this.applyFacets(query, data.filter.attribute, categoryIds);

		const [entries, total] = await query
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);

		const withVariants = await this.attachGrossPrices(
			await this.attachVariants(entries, data.filter.language),
		);

		return [await this.attachCoverImages(withVariants), total] as const;
	}

	public async findByFilter(
		data: ValidatorOutput<ProductValidator, 'find'>,
		withDeleted: boolean,
	) {
		const query = this.repository
			.createQuery()
			.join(
				'product.contents',
				'content',
				'LEFT',
				'content.language = :language',
				{ language: data.filter.language },
			)
			.join('product.brand', 'brand', 'LEFT')
			// Pinned to live links for the same reason as `getEntryData`: `withDeleted` is
			// about listing deleted products, not about naming categories they were unlinked
			// from
			.join(
				'product.categories',
				'product_category',
				'LEFT',
				'product_category.deleted_at IS NULL',
			)
			.join('product_category.category', 'category', 'LEFT')
			.join(
				'category.contents',
				'category_content',
				'LEFT',
				'category_content.language = :language',
			)
			.join(
				'product.variants',
				'variant',
				'LEFT',
				'variant.is_default = true AND variant.deleted_at IS NULL',
			)
			.join('variant.prices', 'price', 'LEFT', 'price.deleted_at IS NULL')
			.select([
				'product.id',
				'product.workflow',
				'product.sale_status',
				'product.type',
				'product.composition',
				'product.unit',
				'product.vat_category',
				'product.available_from',
				'product.available_until',
				'product.discontinued_at',
				'product.brand_id',
				'product.created_at',
				'product.updated_at',
				'product.deleted_at',

				'content.language',
				'content.slug',
				'content.label',

				'brand.id',
				'brand.name',

				'product_category.id',
				'product_category.category_id',
				'category.id',
				'category_content.id',
				'category_content.language',
				'category_content.label',

				'variant.id',
				'variant.sku',
				'variant.track_stock',
				'price.id',
				'price.currency',
				'price.sale_price',
			])
			.filterById(data.filter.id)
			.filterBy('product.workflow', data.filter.workflow)
			.filterBy('product.type', data.filter.type)
			.filterBy('product.composition', data.filter.composition)
			.filterBy('product.sale_status', data.filter.sale_status)
			.filterBy('product.brand_id', data.filter.brand_id)
			.filterByTerm(data.filter.term)
			.filterBySellable(data.filter.is_sellable)
			.withDeleted(withDeleted && data.filter.is_deleted);

		/*
		 * Pinned to live links like the display joins above, and here it is the filter that
		 * depends on it: `withDeleted` lifts TypeORM's condition from every join, so without
		 * this a product unlinked from a category in an earlier edit still answers that
		 * category's filter as soon as an admin ticks "deleted".
		 */
		if (data.filter.category_id) {
			query
				.join(
					'product.categories',
					'category_filter',
					'INNER',
					'category_filter.deleted_at IS NULL',
				)
				.filterRaw('category_filter.category_id IN (:...categoryIds)', {
					categoryIds: await this.resolveCategorySubtree(
						data.filter.category_id,
					),
				});
		}

		if (data.filter.tag_id) {
			query
				.join('product.tags', 'tag', 'INNER', 'tag.deleted_at IS NULL')
				.filterBy('tag.tag_id', data.filter.tag_id);
		}

		return query
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const productService = new ProductService(getProductRepository());
