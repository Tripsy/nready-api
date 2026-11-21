import { expect, jest } from '@jest/globals';
import type ProductEntity from '@/features/product/product.entity';
import {
	ProductCompositionEnum,
	ProductSaleStatusEnum,
	ProductTypeEnum,
	ProductUnitEnum,
	ProductWorkflowEnum,
} from '@/features/product/product.entity';
import {
	getProductEntityMock,
	productInputPayloads,
	productOutputPayloads,
} from '@/features/product/product.mock';
import type { ProductQuery } from '@/features/product/product.repository';
import { ProductService } from '@/features/product/product.service';
import type { ProductValidator } from '@/features/product/product.validator';
import { ProductAttributeRepository } from '@/features/product/product-attribute.repository';
import { ProductAvailabilityRepository } from '@/features/product/product-availability.repository';
import { ProductBundleRepository } from '@/features/product/product-bundle.repository';
import ProductBundleGroupEntity from '@/features/product/product-bundle-group.entity';
import ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import { ProductCategoryRepository } from '@/features/product/product-category.repository';
import {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import { getProductCategoryAttributeEntityMock } from '@/features/product/product-category-attribute.mock';
import { productCategoryAttributeService } from '@/features/product/product-category-attribute.service';
import { ProductContentRepository } from '@/features/product/product-content.repository';
import { ProductOptionRepository } from '@/features/product/product-option.repository';
import { ProductTagRepository } from '@/features/product/product-tag.repository';
import ProductVariantEntity from '@/features/product/product-variant.entity';
import { ProductVariantRepository } from '@/features/product/product-variant.repository';
import { cacheProvider } from '@/providers/cache.provider';
import type { EntityId } from '@/shared/types/entity-id.type';
import { MeasureUnitEnum } from '@/shared/types/measure-unit.type';
import {
	createMockQuery,
	createMockRepository,
	setupTransactionMock,
	testServiceDelete,
	testServiceFindByFilter,
	testServiceFindById,
	testServiceRestore,
} from '@/tests/jest-service.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

/**
 * `save` echoing its input back - what a test asserting on the row the service *built* needs.
 * Cast because TypeORM's `save` is overloaded, and no single implementation signature satisfies
 * every overload.
 */
function echoSave(save: unknown): void {
	(save as jest.Mock).mockImplementation(async (row: unknown) => row);
}

describe('ProductService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mockProduct = createMockRepository<ProductEntity, ProductQuery>();
	const service = new ProductService(mockProduct.repository);

	/**
	 * Every child table the service writes through, silenced in one call.
	 *
	 * The returned query is `product_category`'s own: an update that omits the links still
	 * reads them, because the attribute definitions are resolved from the product's categories
	 * and a payload changing only an attribute would otherwise be checked against no schema.
	 */
	function stubRelationWrites() {
		const categoryLinkQuery = createMockQuery();

		categoryLinkQuery.all.mockResolvedValue([] as never);

		jest.spyOn(ProductCategoryRepository, 'createQuery').mockReturnValue(
			categoryLinkQuery as never,
		);

		jest.spyOn(ProductContentRepository, 'saveContent').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ProductCategoryRepository, 'syncLinks').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ProductTagRepository, 'syncLinks').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ProductVariantRepository, 'syncVariants').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ProductAttributeRepository, 'syncValues').mockResolvedValue(
			undefined,
		);
		jest.spyOn(
			ProductAvailabilityRepository,
			'syncWindows',
		).mockResolvedValue(undefined);
		jest.spyOn(ProductOptionRepository, 'syncGroups').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ProductBundleRepository, 'syncItems').mockResolvedValue(
			undefined,
		);
		jest.spyOn(ProductBundleRepository, 'syncGroups').mockResolvedValue(
			undefined,
		);
		jest.spyOn(
			ProductContentRepository,
			'findConflictingSlug',
		).mockResolvedValue(null);

		return { categoryLinkQuery };
	}

	/**
	 * The attribute definitions a value is checked against. Empty by default, so a test that
	 * does not care about the schema still gets a service that refuses undeclared labels.
	 */
	function stubDefinitions(
		definitions: ReturnType<
			typeof getProductCategoryAttributeEntityMock
		>[] = [],
	) {
		jest.spyOn(
			productCategoryAttributeService,
			'resolveDefinitionsByLabel',
		).mockResolvedValue(
			new Map(
				definitions.map((definition) => [
					definition.attribute_label_id,
					definition,
				]),
			),
		);
	}

	/**
	 * `manager.getRepository` dispatches by entity: the bundle checks reach for the variant and
	 * the bundle-item repositories, and handing both the same stub would let a test pass on the
	 * wrong table's answer.
	 */
	function transactionWith(
		byEntity: Map<unknown, unknown> = new Map(),
	): ReturnType<typeof setupTransactionMock> {
		const setup = setupTransactionMock(mockProduct.repository);

		setup.manager.getRepository.mockImplementation(
			(entity: unknown) => byEntity.get(entity) ?? mockProduct.repository,
		);

		return setup;
	}

	describe('create', () => {
		it('writes the row and every branch inside one transaction', async () => {
			const entity = getProductEntityMock();
			const createData = productOutputPayloads.create;

			const { transaction } = transactionWith();

			mockProduct.repository.save.mockResolvedValue(entity);

			stubRelationWrites();
			stubDefinitions();

			const result = await service.create(createData);

			expect(transaction).toHaveBeenCalled();

			expect(ProductContentRepository.saveContent).toHaveBeenCalledWith(
				expect.anything(),
				createData.contents,
				entity.id,
			);
			expect(ProductCategoryRepository.syncLinks).toHaveBeenCalledWith(
				expect.anything(),
				entity.id,
				productInputPayloads.create.categories,
			);
			expect(ProductTagRepository.syncLinks).toHaveBeenCalledWith(
				expect.anything(),
				entity.id,
				productInputPayloads.create.tags,
			);
			expect(ProductVariantRepository.syncVariants).toHaveBeenCalled();

			expect(result).toBe(entity);
		});

		it('rejects a create whose slug belongs to another product', async () => {
			stubRelationWrites();

			jest.spyOn(
				ProductContentRepository,
				'findConflictingSlug',
			).mockResolvedValue({ id: mockId(99) } as never);

			await expect(
				service.create(productOutputPayloads.create),
			).rejects.toMatchObject({ statusCode: 409 });
		});

		/*
		 * `repository.create()` builds the row without applying the column defaults, and
		 * `assertUnitForType` reads both values before the insert - so an omitted `type`
		 * would index `UNITS_BY_TYPE` with `undefined` and a payload the docs call valid
		 * would fail. The columns the service does not read pre-save are left to Postgres,
		 * which returns them on the insert.
		 */
		it('resolves the type and unit defaults before the pairing is checked', async () => {
			transactionWith();

			stubRelationWrites();
			stubDefinitions();

			echoSave(mockProduct.repository.save);

			const saved = await service.create({
				...productOutputPayloads.create,
				type: undefined,
				unit: undefined,
			});

			expect(saved.type).toBe(ProductTypeEnum.PHYSICAL);
			expect(saved.unit).toBe(ProductUnitEnum.PIECE);
		});
	});

	/*
	 * `syncAttributes` reads an empty array as "clear the axis values", so absent has to stay
	 * distinguishable from `[]` the whole way to the repository. The dashboard sends no
	 * `variants[].attributes`, and collapsing the two would make an edit that only touches the
	 * product name destroy the values that tell the sibling variants apart.
	 */
	describe('variant attributes are only written when the payload states them', () => {
		const [defaultVariant] = productOutputPayloads.create.variants;

		async function createWithVariantAttributes(
			attributes: (typeof defaultVariant)['attributes'],
		) {
			transactionWith();

			stubRelationWrites();
			stubDefinitions();

			echoSave(mockProduct.repository.save);

			await service.create({
				...productOutputPayloads.create,
				variants: [{ ...defaultVariant, attributes }],
			});

			const call = jest.mocked(ProductVariantRepository.syncVariants).mock
				.calls[0];

			return call[2][0].attributes;
		}

		it('passes nothing on when the payload omits them', async () => {
			expect(
				await createWithVariantAttributes(undefined),
			).toBeUndefined();
		});

		it('passes an empty array on, which clears the stored values', async () => {
			expect(await createWithVariantAttributes([])).toEqual([]);
		});
	});

	/*
	 * `sale_status` is derived, never stated - the timestamps are what an editor edits and this
	 * is only their projection, which is why the column carries no transition map. It is applied
	 * on every write as well as by the cron, or a product created with a future opening date
	 * would read as sellable until the next cron pass.
	 */
	describe('sale_status is derived from the availability timestamps', () => {
		const inADay = () => new Date(Date.now() + 86400 * 1000);
		const aDayAgo = () => new Date(Date.now() - 86400 * 1000);

		const cases: {
			label: string;
			dates: Record<string, Date>;
			expected: string;
		}[] = [
			{
				label: 'coming_soon while available_from is in the future',
				dates: { available_from: inADay() },
				expected: ProductSaleStatusEnum.COMING_SOON,
			},
			{
				label: 'unavailable once available_until has passed',
				dates: { available_until: aDayAgo() },
				expected: ProductSaleStatusEnum.UNAVAILABLE,
			},
			{
				label: 'discontinued outranks both',
				dates: {
					available_from: aDayAgo(),
					discontinued_at: aDayAgo(),
				},
				expected: ProductSaleStatusEnum.DISCONTINUED,
			},
			{
				label: 'available inside the window',
				dates: {
					available_from: aDayAgo(),
					available_until: inADay(),
				},
				expected: ProductSaleStatusEnum.AVAILABLE,
			},
		];

		cases.forEach(({ label, dates, expected }) => {
			it(label, async () => {
				transactionWith();

				stubRelationWrites();
				stubDefinitions();

				echoSave(mockProduct.repository.save);

				const saved = await service.create({
					...productOutputPayloads.create,
					...dates,
				});

				expect(saved.sale_status).toBe(expected);
			});
		});
	});

	describe('recomputeSaleStatus', () => {
		it('reports no change when the column already agrees', async () => {
			const entity = getProductEntityMock();

			const changed = await service.recomputeSaleStatus(entity);

			expect(changed).toBe(false);
			expect(mockProduct.repository.save).not.toHaveBeenCalled();
		});

		it('moves a product time has overtaken', async () => {
			const entity = getProductEntityMock();

			entity.available_until = new Date(Date.now() - 86400 * 1000);

			mockProduct.repository.save.mockResolvedValue(entity);

			const changed = await service.recomputeSaleStatus(entity);

			expect(changed).toBe(true);
			expect(entity.sale_status).toBe(ProductSaleStatusEnum.UNAVAILABLE);
			expect(mockProduct.repository.save).toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('leaves a branch untouched when the payload omits it', async () => {
			const entity = getProductEntityMock();

			transactionWith();

			mockProduct.repository.save.mockResolvedValue(entity);

			stubRelationWrites();
			stubDefinitions();

			// `tags` absent means "leave alone"; an empty array would clear them
			await service.updateDataWithContent(entity, {
				id: entity.id,
				vat_category: 'standard',
			} as never);

			expect(ProductCategoryRepository.syncLinks).not.toHaveBeenCalled();
			expect(ProductTagRepository.syncLinks).not.toHaveBeenCalled();
			expect(
				ProductVariantRepository.syncVariants,
			).not.toHaveBeenCalled();
			expect(ProductOptionRepository.syncGroups).not.toHaveBeenCalled();
		});

		/*
		 * The definitions are resolved from the product's categories, so a payload that omits
		 * the links has to be checked against the ones already stored - otherwise an edit that
		 * only changes an attribute would be validated against no schema at all.
		 */
		it('reads the stored category links when the payload omits them', async () => {
			const entity = getProductEntityMock();

			transactionWith();

			mockProduct.repository.save.mockResolvedValue(entity);

			const { categoryLinkQuery } = stubRelationWrites();

			stubDefinitions([getProductCategoryAttributeEntityMock()]);

			categoryLinkQuery.all.mockResolvedValue([
				{ category_id: mockId(4) },
			] as never);

			await service.updateDataWithContent(entity, {
				id: entity.id,
				attributes: [
					{ attribute_label_id: mockId(11), value_numeric: 500 },
				],
			} as never);

			expect(
				productCategoryAttributeService.resolveDefinitionsByLabel,
			).toHaveBeenCalledWith(
				[mockId(4)],
				ProductCategoryAttributeScopeEnum.PRODUCT,
				{ assertScopeAgreement: true },
			);
		});

		it('cleans the product cache once per update, after the transaction', async () => {
			const entity = getProductEntityMock();

			transactionWith();

			mockProduct.repository.save.mockResolvedValue(entity);

			stubRelationWrites();
			stubDefinitions();

			const cleans: string[] = [];

			jest.spyOn(cacheProvider, 'deleteByPattern').mockImplementation(
				async (pattern: string) => {
					cleans.push(pattern);
				},
			);

			// Several branches in one call - the clean is per operation, not per row
			await service.updateDataWithContent(entity, {
				id: entity.id,
				categories: [mockId(1), mockId(2)],
				tags: [mockId(3), mockId(4)],
				availabilities: [],
			} as never);

			expect(cleans).toEqual([
				`${cacheProvider.buildKey('product', entity.id.toString())}*`,
			]);
		});

		/*
		 * The validator rejects a payload carrying both dates inverted, but it only sees the
		 * payload: an update moving one date alone is compared against nothing there.
		 */
		it('rejects an update that inverts the window against the stored row', async () => {
			const entity = getProductEntityMock();

			entity.available_from = new Date('2026-09-01T10:00:00.000Z');

			transactionWith();

			stubRelationWrites();
			stubDefinitions();

			await expect(
				service.updateDataWithContent(entity, {
					id: entity.id,
					available_until: new Date('2026-08-01T10:00:00.000Z'),
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});
	});

	describe('attribute values are checked against the definition that governs them', () => {
		async function saveAttribute(
			value: Record<string, unknown>,
			definitions = [getProductCategoryAttributeEntityMock()],
		) {
			const entity = getProductEntityMock();

			transactionWith();

			mockProduct.repository.save.mockResolvedValue(entity);

			const { categoryLinkQuery } = stubRelationWrites();

			stubDefinitions(definitions);

			categoryLinkQuery.all.mockResolvedValue([
				{ category_id: mockId(4) },
			] as never);

			return service.updateDataWithContent(entity, {
				id: entity.id,
				attributes: [value],
			} as never);
		}

		/*
		 * `is_required` is the one rule the per-value checks cannot reach: a required attribute
		 * the payload simply omits has no row for them to look at.
		 */
		it('rejects a payload that omits a required attribute', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			definition.is_required = true;

			const entity = getProductEntityMock();

			transactionWith();

			mockProduct.repository.save.mockResolvedValue(entity);

			const { categoryLinkQuery } = stubRelationWrites();

			stubDefinitions([definition]);

			categoryLinkQuery.all.mockResolvedValue([
				{ category_id: mockId(4) },
			] as never);

			await expect(
				service.updateDataWithContent(entity, {
					id: entity.id,
					attributes: [],
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('accepts the same payload once the required attribute is supplied', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			definition.is_required = true;

			await expect(
				saveAttribute(
					{
						attribute_label_id: definition.attribute_label_id,
						value_numeric: 500,
					},
					[definition],
				),
			).resolves.toBeDefined();
		});

		/**
		 * A variant axis states what tells siblings apart, so it is demanded of every variant -
		 * except a bundle's, which has none. The bundle editor does not offer the `variant`
		 * scope at all, so demanding it there would make the bundle unsavable in any category
		 * declaring a required one, with nothing an editor could supply.
		 */
		function saveVariant(
			composition: (typeof ProductCompositionEnum)[keyof typeof ProductCompositionEnum],
			definitions: ReturnType<
				typeof getProductCategoryAttributeEntityMock
			>[],
		) {
			const entity = getProductEntityMock();

			entity.composition = composition;

			/*
			 * A bundle write also runs the composition checks, which read the variant and
			 * bundle-item tables - stubbed to a bundle that is already large enough, so the
			 * size rule does not stand in for the one under test.
			 */
			const builder = {
				select: jest.fn(() => builder),
				where: jest.fn(() => builder),
				// Typed with the clause it is called with, so a test can assert the narrowing
				andWhere: jest.fn((_clause: string) => builder),
				getRawOne: jest.fn(async () => ({ total: '2' })),
			};

			transactionWith(
				new Map<unknown, unknown>([
					[ProductVariantEntity, { find: jest.fn(async () => []) }],
					[
						ProductBundleItemEntity,
						{ createQueryBuilder: jest.fn(() => builder) },
					],
				]),
			);

			mockProduct.repository.save.mockResolvedValue(entity);

			const { categoryLinkQuery } = stubRelationWrites();

			stubDefinitions(definitions);

			categoryLinkQuery.all.mockResolvedValue([
				{ category_id: mockId(4) },
			] as never);

			return service.updateDataWithContent(entity, {
				id: entity.id,
				variants: [{ sku: 'SKU-1', is_default: true, attributes: [] }],
			} as never);
		}

		it('rejects a variant that omits a required variant attribute', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			definition.is_required = true;

			await expect(
				saveVariant(ProductCompositionEnum.SIMPLE, [definition]),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('accepts the same variant on a bundle, which has no axis to state', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			definition.is_required = true;

			await expect(
				saveVariant(ProductCompositionEnum.BUNDLE, [definition]),
			).resolves.toBeDefined();
		});

		it('rejects a label the product categories do not declare', async () => {
			await expect(
				saveAttribute({
					attribute_label_id: mockId(999),
					value_numeric: 1,
				}),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('rejects a value of the wrong shape for the definition', async () => {
			// The definition mock is numeric; a term is not what it stores
			await expect(
				saveAttribute({
					attribute_label_id: mockId(11),
					value_term_id: mockId(13),
				}),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('rejects a number outside the definition bounds', async () => {
			await expect(
				saveAttribute({
					attribute_label_id: mockId(11),
					value_numeric: 99,
				}),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		// The whole reason `value_base` exists: a range filter compares it, so the conversion
		// happens once, on write, instead of between the filter and its index
		it('normalizes a number through the definition unit', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			// The bounds are quoted in the definition's own unit, like the value they bound,
			// so a min of 100 would be 100 *litres* here
			definition.unit = MeasureUnitEnum.LITRE;
			definition.min_value = null;
			definition.max_value = null;

			await saveAttribute(
				{ attribute_label_id: mockId(11), value_numeric: 0.5 },
				[definition],
			);

			expect(ProductAttributeRepository.syncValues).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(String),
				[
					expect.objectContaining({
						value_numeric: 0.5,
						value_base: 500,
					}),
				],
			);
		});

		it('leaves value_base null for a term-backed value', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			definition.value_type = ProductCategoryAttributeValueTypeEnum.TERM;
			definition.type = ProductCategoryAttributeTypeEnum.SELECT;
			definition.unit = null;
			definition.min_value = null;
			definition.max_value = null;
			definition.options = [{ term_id: mockId(13) }] as never;

			await saveAttribute(
				{ attribute_label_id: mockId(11), value_term_id: mockId(13) },
				[definition],
			);

			expect(ProductAttributeRepository.syncValues).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(String),
				[expect.objectContaining({ value_base: null })],
			);
		});

		// The second half of the invariant `product_category_attribute_option` cannot hold -
		// it spans three tables
		it('rejects a term that is not on the definition option list', async () => {
			const definition = getProductCategoryAttributeEntityMock();

			definition.value_type = ProductCategoryAttributeValueTypeEnum.TERM;
			definition.type = ProductCategoryAttributeTypeEnum.SELECT;
			definition.unit = null;
			definition.min_value = null;
			definition.max_value = null;
			definition.options = [{ term_id: mockId(13) }] as never;

			await expect(
				saveAttribute(
					{
						attribute_label_id: mockId(11),
						value_term_id: mockId(99),
					},
					[definition],
				),
			).rejects.toMatchObject({ statusCode: 422 });
		});
	});

	describe('composition', () => {
		/**
		 * A repository whose `createQueryBuilder` chain answers one `SUM`, which is how the
		 * composition check reads a bundle's size. `andWhere` is part of the chain because that
		 * check narrows to the components that are always included.
		 */
		function sumRepository(total: number) {
			const builder = {
				select: jest.fn(() => builder),
				where: jest.fn(() => builder),
				// Typed with the clause it is called with, so a test can assert the narrowing
				andWhere: jest.fn((_clause: string) => builder),
				getRawOne: jest.fn(async () => ({ total: String(total) })),
			};

			return { createQueryBuilder: jest.fn(() => builder), builder };
		}

		/**
		 * Arranges a bundle write. `componentProduct` is what the referenced variant belongs
		 * to, which is what the nesting check reads; `includedUnits` is the figure the
		 * composition check sums - the quantities of the components that are always included.
		 *
		 * It defaults to a bundle that is already large enough, so a test about something else
		 * does not trip the size rule.
		 */
		/**
		 * The groups `assertBundleGroupsAreUsable` reads back, and `resolveComponentGroups`
		 * resolves a component's label against. Each is given the candidate count the assertion
		 * counts, since the rows themselves are only ever read for that.
		 */
		function groupRepository(
			groups: {
				id: EntityId;
				label_id: EntityId;
				candidates: number;
			}[],
		) {
			return {
				find: jest.fn(async () =>
					groups.map((group) => ({
						id: group.id,
						label_id: group.label_id,
						label: { contents: [{ value: 'Choose your fries' }] },
						items: Array.from({ length: group.candidates }, () => ({
							deleted_at: null,
						})),
					})),
				),
			};
		}

		function arrangeBundle(options: {
			componentProduct?: Partial<ProductEntity>;
			componentProductId?: EntityId;
			includedUnits?: number;
			groups?: Parameters<typeof groupRepository>[0];
		}) {
			const entity = getProductEntityMock();

			const variantRepository = {
				find: jest.fn(async () => [
					{
						id: mockId(3),
						product_id: options.componentProductId ?? 42,
						product: options.componentProduct ?? {
							composition: ProductCompositionEnum.SIMPLE,
						},
					},
				]),
			};

			const bundleItemRepository = sumRepository(
				options.includedUnits ?? 2,
			);

			transactionWith(
				new Map<unknown, unknown>([
					[ProductVariantEntity, variantRepository],
					[ProductBundleItemEntity, bundleItemRepository],
					[
						ProductBundleGroupEntity,
						groupRepository(options.groups ?? []),
					],
				]),
			);

			mockProduct.repository.save.mockResolvedValue(entity);

			stubRelationWrites();
			stubDefinitions();

			return { entity, bundleItemRepository };
		}

		const bundlePayload = {
			composition: ProductCompositionEnum.BUNDLE,
			bundle_items: [{ variant_id: mockId(3), quantity: 1 }],
		};

		it('accepts a bundle whose components are simple products', async () => {
			const { entity } = arrangeBundle({});

			await service.updateDataWithContent(entity, {
				id: entity.id,
				...bundlePayload,
			} as never);

			expect(ProductBundleRepository.syncItems).toHaveBeenCalled();
		});

		/*
		 * A cycle no constraint can detect: an order line explodes a bundle into one child per
		 * component, and a child that is itself a bundle would have to explode again.
		 */
		it('rejects a component that is itself a bundle', async () => {
			const { entity } = arrangeBundle({
				componentProduct: {
					composition: ProductCompositionEnum.BUNDLE,
				},
			});

			await expect(
				service.updateDataWithContent(entity, {
					id: entity.id,
					...bundlePayload,
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('rejects a bundle containing one of its own variants', async () => {
			const entity = getProductEntityMock();

			const { entity: arranged } = arrangeBundle({
				componentProductId: entity.id,
			});

			await expect(
				service.updateDataWithContent(arranged, {
					id: arranged.id,
					...bundlePayload,
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		/*
		 * A bundle has to be more than one thing, or it is a product wearing a bundle's
		 * clothes. Counted in units the customer receives, which is what makes one component
		 * taken twice a bundle and one taken once not - and counted over the components that
		 * are always included, since every optional one can be left unticked.
		 */
		it.each([
			['no components at all', 0],
			['one component, quantity 1', 1],
		])('rejects a bundle of %s', async (_label, includedUnits) => {
			const { entity } = arrangeBundle({ includedUnits });

			await expect(
				service.updateDataWithContent(entity, {
					id: entity.id,
					...bundlePayload,
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it.each([
			['two components', 2],
			['one component, quantity 2', 2],
			['three components', 3],
		])('accepts a bundle of %s', async (_label, includedUnits) => {
			const { entity } = arrangeBundle({ includedUnits });

			await service.updateDataWithContent(entity, {
				id: entity.id,
				...bundlePayload,
			} as never);

			expect(ProductBundleRepository.syncItems).toHaveBeenCalled();
		});

		it('rejects a bundle whose mandatory components fall short, however many it offers', async () => {
			const { entity } = arrangeBundle({ includedUnits: 1 });

			await expect(
				service.updateDataWithContent(entity, {
					id: entity.id,
					...bundlePayload,
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('accepts optional components on top of a bundle that already stands alone', async () => {
			const { entity } = arrangeBundle({ includedUnits: 2 });

			await service.updateDataWithContent(entity, {
				id: entity.id,
				...bundlePayload,
			} as never);

			expect(ProductBundleRepository.syncItems).toHaveBeenCalled();
		});

		/*
		 * Switching back is how a bundle is unmade. Rows nothing reads would still name
		 * variants whose delete they then block through the RESTRICT foreign key.
		 */
		it('clears the components when the product goes back to simple', async () => {
			const { entity } = arrangeBundle({});

			await service.updateDataWithContent(entity, {
				id: entity.id,
				composition: ProductCompositionEnum.SIMPLE,
			} as never);

			expect(ProductBundleRepository.syncItems).toHaveBeenCalledWith(
				expect.anything(),
				entity.id,
				[],
			);
			expect(ProductBundleRepository.syncGroups).toHaveBeenCalledWith(
				expect.anything(),
				entity.id,
				[],
			);
		});

		describe('choice groups', () => {
			const groupPayload = {
				composition: ProductCompositionEnum.BUNDLE,
				bundle_groups: [{ label_id: mockId(41), position: 0 }],
				bundle_items: [
					{ variant_id: mockId(3), group_label_id: mockId(41) },
				],
			};

			/*
			 * The payload names the group by its label because the group may be created by the
			 * same request; the column holds a row id, and only the rows live after the group
			 * sync can bridge the two.
			 */
			it('resolves a component label to the group row id', async () => {
				const { entity } = arrangeBundle({
					groups: [
						{
							id: mockId(7),
							label_id: mockId(41),
							candidates: 2,
						},
					],
				});

				await service.updateDataWithContent(entity, {
					id: entity.id,
					...groupPayload,
				} as never);

				expect(ProductBundleRepository.syncItems).toHaveBeenCalledWith(
					expect.anything(),
					entity.id,
					[
						expect.objectContaining({
							variant_id: mockId(3),
							group_id: mockId(7),
						}),
					],
				);
			});

			it('leaves a component outside every group as group_id null', async () => {
				const { entity } = arrangeBundle({});

				await service.updateDataWithContent(entity, {
					id: entity.id,
					...bundlePayload,
				} as never);

				expect(ProductBundleRepository.syncItems).toHaveBeenCalledWith(
					expect.anything(),
					entity.id,
					[expect.objectContaining({ group_id: null })],
				);
			});

			// The group it names may have been removed by this very request
			it('rejects a component naming a group the bundle does not have', async () => {
				const { entity } = arrangeBundle({ groups: [] });

				await expect(
					service.updateDataWithContent(entity, {
						id: entity.id,
						...groupPayload,
					} as never),
				).rejects.toMatchObject({ statusCode: 422 });
			});

			// A question with no answers; the bundle could not be ordered
			it('rejects a group left with no candidates', async () => {
				const { entity } = arrangeBundle({
					groups: [
						{
							id: mockId(7),
							label_id: mockId(41),
							candidates: 0,
						},
					],
				});

				await expect(
					service.updateDataWithContent(entity, {
						id: entity.id,
						...groupPayload,
					} as never),
				).rejects.toMatchObject({ statusCode: 422 });
			});

			/*
			 * The floor has to hold for the least the customer can walk away with. A group
			 * guarantees *a* candidate is taken, not that one, and their quantities may differ,
			 * so a bundle whose whole content is one choice is a single product with a decision
			 * attached.
			 */
			it('leaves candidates out of the two-unit floor', async () => {
				const { entity, bundleItemRepository } = arrangeBundle({
					groups: [
						{
							id: mockId(7),
							label_id: mockId(41),
							candidates: 2,
						},
					],
				});

				await service.updateDataWithContent(entity, {
					id: entity.id,
					...groupPayload,
				} as never);

				expect(
					bundleItemRepository.builder.andWhere,
				).toHaveBeenCalledWith('item.group_id IS NULL');
			});

			/*
			 * A group takes exactly one of its candidates, so one candidate is not an
			 * alternative to anything - it is a component that is always included wearing a
			 * prompt.
			 */
			it('rejects a group left with a single candidate', async () => {
				const { entity } = arrangeBundle({
					groups: [
						{
							id: mockId(7),
							label_id: mockId(41),
							candidates: 1,
						},
					],
				});

				await expect(
					service.updateDataWithContent(entity, {
						id: entity.id,
						...groupPayload,
					} as never),
				).rejects.toMatchObject({ statusCode: 422 });
			});
		});
	});

	describe('updateWorkflow', () => {
		it('refuses a move to the status the product already holds', async () => {
			const entity = getProductEntityMock();

			await expect(
				service.updateWorkflow(entity, ProductWorkflowEnum.DRAFT),
			).rejects.toThrow('shared.error.status_unchanged');
		});

		it('refuses a hop the transition map does not allow', async () => {
			const entity = getProductEntityMock();

			await expect(
				service.updateWorkflow(entity, ProductWorkflowEnum.READY),
			).rejects.toThrow('shared.error.status_update_not_allowed');
		});

		it('moves the product one allowed hop', async () => {
			const entity = getProductEntityMock();

			mockProduct.repository.save.mockResolvedValue(entity);

			await service.updateWorkflow(
				entity,
				ProductWorkflowEnum.PENDING_REVIEW,
			);

			expect(entity.workflow).toBe(ProductWorkflowEnum.PENDING_REVIEW);
			expect(mockProduct.repository.save).toHaveBeenCalled();
		});
	});

	/*
	 * The catalog search is the one thing dropping `product.sku` had to preserve: a warehouse code
	 * still has to find its product, and it now does so through the variant. The SQL that does it
	 * lives on `ProductQuery` and is asserted in `product-repository.test.ts`; what the service
	 * owes is simply handing the term over.
	 */
	describe('findByFilter search and ordering', () => {
		it('passes the term to the query', async () => {
			mockProduct.query.all.mockResolvedValue([[], 0] as never);

			await service.findByFilter(
				{
					...productOutputPayloads.find,
					filter: {
						...productOutputPayloads.find.filter,
						term: 'PRD-0001',
					},
				},
				false,
			);

			expect(mockProduct.query.filterByTerm).toHaveBeenCalledWith(
				'PRD-0001',
			);
		});

		// `order_by` reaches the query builder as given: every admissible value is a column of
		// `product`, so there is no alias to map
		it('passes order_by straight to the query', async () => {
			mockProduct.query.all.mockResolvedValue([[], 0] as never);

			await service.findByFilter(
				{ ...productOutputPayloads.find, order_by: 'created_at' },
				false,
			);

			expect(mockProduct.query.orderBy).toHaveBeenCalledWith(
				'created_at',
				productOutputPayloads.find.direction,
			);
		});
	});

	testServiceFindById<ProductEntity, ProductQuery>(
		mockProduct.query,
		service,
	);

	testServiceFindByFilter<ProductEntity, ProductQuery, ProductValidator>(
		mockProduct.query,
		service,
		productOutputPayloads.find,
	);

	testServiceDelete<ProductEntity, ProductQuery>(mockProduct.query, service);

	testServiceRestore<ProductEntity, ProductQuery>(mockProduct.query, service);
});
