import { expect, jest } from '@jest/globals';
import { QueryFailedError } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ProductAttributeEntity from '@/features/product/product-attribute.entity';
import type ProductCategoryAttributeEntity from '@/features/product/product-category-attribute.entity';
import {
	ProductCategoryAttributeScopeEnum,
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import {
	getProductCategoryAttributeEntityMock,
	productCategoryAttributeOutputPayloads,
} from '@/features/product/product-category-attribute.mock';
import type {
	ProductCategoryAttributeQuery,
	ProductCategoryAttributeRepository,
} from '@/features/product/product-category-attribute.repository';
import { ProductCategoryAttributeService } from '@/features/product/product-category-attribute.service';
import type { ProductCategoryAttributeValidator } from '@/features/product/product-category-attribute.validator';
import type { EntityId } from '@/shared/types/entity-id.type';
import { MeasureUnitEnum } from '@/shared/types/measure-unit.type';
import {
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

describe('ProductCategoryAttributeService', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	const mock = createMockRepository<
		ProductCategoryAttributeEntity,
		ProductCategoryAttributeQuery
	>();

	/*
	 * The service is constructed with the extended repository, so its two custom methods have
	 * to live on the injected object - spying on the exported singleton would leave the
	 * service holding the unstubbed one.
	 */
	const repository = Object.assign(mock.repository, {
		syncOptions: jest.fn(
			async (
				_manager: unknown,
				_attributeId: EntityId,
				_options: unknown[],
			) => undefined,
		),
		findForCategories: jest.fn(
			async () => [] as { definition: unknown; depth: number }[],
		),
	});

	const service = new ProductCategoryAttributeService(
		repository as unknown as typeof ProductCategoryAttributeRepository,
	);

	/** A definition as the payload would leave it, before the service applies the defaults. */
	const termDefinition = {
		category_id: mockId(4),
		attribute_label_id: mockId(8),
		value_type: ProductCategoryAttributeValueTypeEnum.TERM,
		type: ProductCategoryAttributeTypeEnum.SELECT,
		options: [{ term_id: mockId(12), sort_order: 10 }],
	};

	describe('create', () => {
		it('writes the definition and its admissible values in one transaction', async () => {
			const entity = getProductCategoryAttributeEntityMock();

			const { transaction } = setupTransactionMock(mock.repository);

			mock.repository.save.mockResolvedValue(entity);

			const result = await service.create(termDefinition as never);

			expect(transaction).toHaveBeenCalled();
			expect(repository.syncOptions).toHaveBeenCalledWith(
				expect.anything(),
				entity.id,
				termDefinition.options,
			);
			expect(result).toBe(entity);
		});

		/*
		 * The column defaults are restated by the service because `assertDefinition` runs
		 * before the insert and has to see the row as it will be stored.
		 */
		it('applies the column defaults before checking the row', async () => {
			const entity = getProductCategoryAttributeEntityMock();

			setupTransactionMock(mock.repository);

			echoSave(mock.repository.save);

			const saved = await service.create({
				category_id: mockId(4),
				attribute_label_id: mockId(8),
				options: [{ term_id: mockId(12) }],
			} as never);

			expect(saved.scope).toBe(ProductCategoryAttributeScopeEnum.PRODUCT);
			expect(saved.value_type).toBe(
				ProductCategoryAttributeValueTypeEnum.TERM,
			);
			expect(saved.type).toBe(ProductCategoryAttributeTypeEnum.SELECT);
			expect(saved.inherit).toBe(true);
			expect(saved.min_value).toBeNull();

			expect(entity.id).toBeDefined();
		});

		// The half no row-level check can make: the admissible values live in another table
		it('refuses a term-backed definition with nothing to offer', async () => {
			setupTransactionMock(mock.repository);

			await expect(
				service.create({
					...termDefinition,
					options: [],
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('refuses options on a definition that stores a number', async () => {
			setupTransactionMock(mock.repository);

			await expect(
				service.create({
					...termDefinition,
					value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
					type: ProductCategoryAttributeTypeEnum.INPUT,
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		// A bare unique violation would reach the client as a masked 500
		it('answers the category/label unique index with a 409', async () => {
			setupTransactionMock(mock.repository);

			const violation = new QueryFailedError('', [], new Error(''));

			Object.assign(violation, {
				code: '23505',
				driverError: {
					code: '23505',
					constraint: 'IDX_product_category_attribute_unique',
				},
			});

			mock.repository.save.mockRejectedValue(violation);

			await expect(
				service.create(termDefinition as never),
			).rejects.toMatchObject({ statusCode: 409 });
		});
	});

	describe('updateData', () => {
		/*
		 * `create` states every field, so the validator can check it. An update carries only
		 * what changed, which is why the rules are re-run against the merged row - moving a
		 * definition from `term` to `number` while leaving its option rows in place is a
		 * two-field change no single-field check can see.
		 */
		it('re-runs the rules against the merged row', async () => {
			const entity = getProductCategoryAttributeEntityMock();

			entity.value_type = ProductCategoryAttributeValueTypeEnum.TERM;
			entity.type = ProductCategoryAttributeTypeEnum.SELECT;
			entity.unit = null;
			entity.min_value = null;
			entity.max_value = null;

			setupTransactionMock(mock.repository);

			// Storage moves to a number while the option rows stay behind
			await expect(
				service.updateData(entity, {
					id: entity.id,
					value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
					type: ProductCategoryAttributeTypeEnum.INPUT,
					options: [{ term_id: mockId(12) }],
				} as never),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		it('leaves the option rows alone when the payload omits them', async () => {
			const entity = getProductCategoryAttributeEntityMock();

			const { manager } = setupTransactionMock(mock.repository);

			// The option count is read back when the payload does not restate it
			manager.getRepository.mockReturnValue({
				...mock.repository,
				findOne: jest.fn(async () => ({ ...entity, options: [] })),
			});

			mock.repository.save.mockResolvedValue(entity);

			await service.updateData(entity, {
				id: entity.id,
				sort_order: 30,
			} as never);

			expect(repository.syncOptions).not.toHaveBeenCalled();
		});

		/*
		 * The validator folds an emptied optional onto `undefined` and keeps the key only when
		 * the request carried it, so presence is the whole difference between *clear this* and
		 * *leave it* - and `save` skips an undefined property, which would collapse the two.
		 */
		it('clears a nullable column the payload emptied', async () => {
			const entity = getProductCategoryAttributeEntityMock();

			entity.value_type = ProductCategoryAttributeValueTypeEnum.NUMBER;
			entity.type = ProductCategoryAttributeTypeEnum.INPUT;
			entity.unit = MeasureUnitEnum.MILLILITRE;
			entity.min_value = 100;
			entity.max_value = 5000;

			const { manager } = setupTransactionMock(mock.repository);

			// No product carries the attribute, so the emptied unit rewrites nothing
			manager.query.mockResolvedValue([] as never);

			echoSave(mock.repository.save);

			// A measurement becoming a list: the unit and the bounds have to go with it, or
			// the merged row fails its own rules
			await service.updateData(entity, {
				id: entity.id,
				value_type: ProductCategoryAttributeValueTypeEnum.TERM,
				type: ProductCategoryAttributeTypeEnum.SELECT,
				unit: undefined,
				min_value: undefined,
				max_value: undefined,
				options: [{ term_id: mockId(12) }],
			} as never);

			expect(entity.unit).toBeNull();
			expect(entity.min_value).toBeNull();
			expect(entity.max_value).toBeNull();
		});

		it('leaves a nullable column the payload never mentions', async () => {
			const entity = getProductCategoryAttributeEntityMock();

			entity.unit = MeasureUnitEnum.MILLILITRE;
			entity.prefix = 'class';

			const { manager } = setupTransactionMock(mock.repository);

			manager.getRepository.mockReturnValue({
				...mock.repository,
				findOne: jest.fn(async () => ({ ...entity, options: [] })),
			});

			echoSave(mock.repository.save);

			await service.updateData(entity, {
				id: entity.id,
				sort_order: 30,
			} as never);

			expect(entity.unit).toBe(MeasureUnitEnum.MILLILITRE);
			expect(entity.prefix).toBe('class');
		});
	});

	describe('updateOrder', () => {
		function arrange(stored: { id: EntityId; sort_order: number }[]) {
			const { manager } = setupTransactionMock(mock.repository);

			const repository = {
				find: jest.fn(async () => stored),
				save: jest.fn(async (rows: unknown) => rows),
			};

			manager.getRepository.mockReturnValue(repository);

			return repository;
		}

		it('applies the given order ascending, leaving room between', async () => {
			const repository = arrange([
				{ id: mockId(7), sort_order: 10 },
				{ id: mockId(8), sort_order: 20 },
			]);

			await service.updateOrder(mockId(4), [mockId(8), mockId(7)]);

			expect(repository.save).toHaveBeenCalledWith([
				expect.objectContaining({ id: mockId(7), sort_order: 20 }),
				expect.objectContaining({ id: mockId(8), sort_order: 10 }),
			]);
		});

		/*
		 * A position only means something relative to its siblings, so a slice cannot describe
		 * an order - and a foreign id would move a definition out from under the category that
		 * declares it.
		 */
		it('refuses a list that is not the whole set', async () => {
			arrange([
				{ id: mockId(7), sort_order: 10 },
				{ id: mockId(8), sort_order: 20 },
			]);

			await expect(
				service.updateOrder(mockId(4), [mockId(7)]),
			).rejects.toMatchObject({
				statusCode: 400,
			});
		});

		it('refuses an id from another category', async () => {
			arrange([
				{ id: mockId(7), sort_order: 10 },
				{ id: mockId(8), sort_order: 20 },
			]);

			await expect(
				service.updateOrder(mockId(4), [mockId(7), mockId(999)]),
			).rejects.toMatchObject({ statusCode: 400 });
		});
	});

	/*
	 * Changing `unit` does not reinterpret the values already recorded - the factor is applied
	 * on write, so each one has to be rewritten or the stored base figures describe a quantity
	 * the form no longer shows.
	 */
	describe('a unit change rewrites the values recorded under it', () => {
		function arrange(
			rows: { value_numeric: number; value_base: number }[],
		) {
			const entity = getProductCategoryAttributeEntityMock();

			entity.unit = MeasureUnitEnum.MILLILITRE;

			const attributeRepository = {
				find: jest.fn(async () => rows),
			};

			const { manager } = setupTransactionMock(mock.repository);

			manager.getRepository.mockImplementation((target: unknown) =>
				target === ProductAttributeEntity
					? attributeRepository
					: {
							...mock.repository,
							findOne: jest.fn(async () => ({
								...entity,
								options: [],
							})),
						},
			);

			// One product sits in the definition's category subtree
			manager.query.mockResolvedValue([
				{ product_id: mockId(1) },
			] as never);

			echoSave(mock.repository.save);

			return { entity, manager, rows };
		}

		it('converts every value through the new factor', async () => {
			const rows = [{ value_numeric: 500, value_base: 500 }];

			const { entity, manager } = arrange(rows);

			await service.updateData(entity, {
				id: entity.id,
				unit: MeasureUnitEnum.LITRE,
			} as never);

			// 500 l is 500 000 ml
			expect(rows[0].value_base).toBe(500000);
			expect(manager.save).toHaveBeenCalledWith(rows);
		});

		it('does nothing when the unit did not move', async () => {
			const rows = [{ value_numeric: 500, value_base: 500 }];

			const { entity, manager } = arrange(rows);

			await service.updateData(entity, {
				id: entity.id,
				sort_order: 99,
			} as never);

			expect(manager.save).not.toHaveBeenCalled();
			expect(rows[0].value_base).toBe(500);
		});
	});

	/*
	 * A product sits in several categories, so the definition set is a union rather than a
	 * lookup: deduped by label with the deepest category winning, then split by scope.
	 */
	describe('resolveForm', () => {
		function definition(
			overrides: Partial<ProductCategoryAttributeEntity>,
		) {
			return {
				...getProductCategoryAttributeEntityMock(),
				...overrides,
			} as ProductCategoryAttributeEntity;
		}

		it('lets the deepest category override an ancestor for the same label', async () => {
			repository.findForCategories.mockResolvedValue([
				{
					definition: definition({
						id: mockId(1),
						attribute_label_id: mockId(8),
						sort_order: 10,
					}),
					depth: 0,
				},
				{
					definition: definition({
						id: mockId(2),
						attribute_label_id: mockId(8),
						sort_order: 10,
					}),
					depth: 2,
				},
			]);

			const form = await service.resolveForm([mockId(5)]);

			const resolved = form[ProductCategoryAttributeScopeEnum.PRODUCT];

			expect(resolved).toHaveLength(1);
			expect(resolved[0].id).toBe(mockId(2));
		});

		/*
		 * Capture and options are a category's to override; scope is not. Two categories
		 * disagreeing about it describe two different rows for one label, and picking a winner
		 * by depth drops whatever was stored under the other - so the write path asks for the
		 * disagreement to be reported instead.
		 */
		function scopeConflict() {
			return [
				{
					definition: definition({
						id: mockId(1),
						category_id: mockId(1),
						attribute_label_id: mockId(8),
						scope: ProductCategoryAttributeScopeEnum.PRODUCT,
					}),
					depth: 0,
				},
				{
					definition: definition({
						id: mockId(2),
						category_id: mockId(14),
						attribute_label_id: mockId(8),
						scope: ProductCategoryAttributeScopeEnum.VARIANT,
					}),
					depth: 1,
				},
			];
		}

		it('rejects two categories that disagree on a label scope', async () => {
			repository.findForCategories.mockResolvedValue(scopeConflict());

			jest.spyOn(dataSource, 'getRepository').mockReturnValue({
				find: jest.fn(async () => [
					{ category_id: mockId(1), label: 'Electronics' },
					{ category_id: mockId(14), label: 'T-shirts' },
				]),
			} as never);

			await expect(
				service.resolveForm([mockId(5)], {
					assertScopeAgreement: true,
				}),
			).rejects.toMatchObject({ statusCode: 422 });
		});

		// The read path resolves it silently on purpose - a `resolve` that threw would leave
		// the form's attributes section looking like the categories declared nothing
		it('resolves the same disagreement when not asked to assert', async () => {
			repository.findForCategories.mockResolvedValue(scopeConflict());

			const form = await service.resolveForm([mockId(5)]);

			expect(
				form[ProductCategoryAttributeScopeEnum.VARIANT].map(
					(row) => row.id,
				),
			).toEqual([mockId(2)]);
		});

		it('accepts two categories that agree on a label scope', async () => {
			repository.findForCategories.mockResolvedValue([
				{
					definition: definition({
						id: mockId(1),
						category_id: mockId(1),
						attribute_label_id: mockId(8),
						scope: ProductCategoryAttributeScopeEnum.PRODUCT,
					}),
					depth: 0,
				},
				{
					definition: definition({
						id: mockId(2),
						category_id: mockId(14),
						attribute_label_id: mockId(8),
						scope: ProductCategoryAttributeScopeEnum.PRODUCT,
					}),
					depth: 1,
				},
			]);

			await expect(
				service.resolveForm([mockId(5)], {
					assertScopeAgreement: true,
				}),
			).resolves.toBeDefined();
		});

		it('splits the resolved set by scope', async () => {
			repository.findForCategories.mockResolvedValue([
				{
					definition: definition({
						id: mockId(1),
						attribute_label_id: mockId(8),
						scope: ProductCategoryAttributeScopeEnum.PRODUCT,
					}),
					depth: 0,
				},
				{
					definition: definition({
						id: mockId(2),
						attribute_label_id: mockId(9),
						scope: ProductCategoryAttributeScopeEnum.VARIANT,
					}),
					depth: 0,
				},
			]);

			const form = await service.resolveForm([mockId(5)]);

			expect(
				form[ProductCategoryAttributeScopeEnum.PRODUCT],
			).toHaveLength(1);
			expect(
				form[ProductCategoryAttributeScopeEnum.VARIANT],
			).toHaveLength(1);
		});

		it('orders the resolved set by sort_order', async () => {
			repository.findForCategories.mockResolvedValue([
				{
					definition: definition({
						id: mockId(1),
						attribute_label_id: mockId(8),
						sort_order: 30,
					}),
					depth: 0,
				},
				{
					definition: definition({
						id: mockId(2),
						attribute_label_id: mockId(9),
						sort_order: 10,
					}),
					depth: 0,
				},
			]);

			const form = await service.resolveForm([mockId(5)]);

			expect(
				form[ProductCategoryAttributeScopeEnum.PRODUCT].map(
					(row) => row.id,
				),
			).toEqual([mockId(2), mockId(1)]);
		});

		it('flattens to a label lookup, which is what a value check needs', async () => {
			repository.findForCategories.mockResolvedValue([
				{
					definition: definition({
						id: mockId(1),
						attribute_label_id: mockId(8),
					}),
					depth: 0,
				},
			]);

			const byLabel = await service.resolveDefinitionsByLabel(
				[mockId(5)],
				ProductCategoryAttributeScopeEnum.PRODUCT,
			);

			expect(byLabel.get(mockId(8))?.id).toBe(mockId(1));
		});
	});

	testServiceFindById<
		ProductCategoryAttributeEntity,
		ProductCategoryAttributeQuery
	>(mock.query, service);

	testServiceFindByFilter<
		ProductCategoryAttributeEntity,
		ProductCategoryAttributeQuery,
		ProductCategoryAttributeValidator
	>(mock.query, service, productCategoryAttributeOutputPayloads.find);

	testServiceDelete<
		ProductCategoryAttributeEntity,
		ProductCategoryAttributeQuery
	>(mock.query, service);

	testServiceRestore<
		ProductCategoryAttributeEntity,
		ProductCategoryAttributeQuery
	>(mock.query, service);
});
