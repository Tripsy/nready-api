import { jest } from '@jest/globals';
import {
	ProductCategoryAttributeTypeEnum,
	ProductCategoryAttributeValueTypeEnum,
} from '@/features/product/product-category-attribute.entity';
import { productCategoryAttributeInputPayloads } from '@/features/product/product-category-attribute.mock';
import { ProductCategoryAttributeValidator } from '@/features/product/product-category-attribute.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';
import { mockId } from '@/tests/mocks/uuid.mock';

beforeEach(() => {
	jest.restoreAllMocks();
});

const attributeValidator = new ProductCategoryAttributeValidator('product');

type ValidatorMethod = keyof Pick<
	typeof attributeValidator,
	'create' | 'update' | 'find' | 'resolve'
>;

const validator = 'ProductCategoryAttributeValidator';
const listSchemas: ValidatorMethod[] = ['create', 'update', 'find', 'resolve'];

const createWith = (overrides: Record<string, unknown>) =>
	attributeValidator.create.safeParse({
		...productCategoryAttributeInputPayloads.create,
		...overrides,
	});

/** A numeric definition, since most of the rules only bite on one. */
const numeric = (overrides: Record<string, unknown> = {}) =>
	createWith({
		value_type: ProductCategoryAttributeValueTypeEnum.NUMBER,
		type: ProductCategoryAttributeTypeEnum.INPUT,
		options: [],
		...overrides,
	});

describe(validator, () => {
	listSchemas.forEach((schemaName) => {
		it(`${schemaName}() accepts valid payload`, () => {
			const schema = attributeValidator[schemaName];
			const payload = productCategoryAttributeInputPayloads[schemaName];
			const validated = schema.safeParse(payload);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	/*
	 * The capture / storage matrix, mirroring the `@Check` on the entity. It is repeated here
	 * because a constraint violation reaches the client as a masked 500, and this pairing is
	 * the first thing a form gets wrong.
	 */
	describe('type and value_type have to agree', () => {
		const cases: {
			type: string;
			value_type: string;
			admissible: boolean;
		}[] = [
			{ type: 'input', value_type: 'number', admissible: true },
			{ type: 'input', value_type: 'string', admissible: true },
			{ type: 'input', value_type: 'boolean', admissible: true },
			{ type: 'input', value_type: 'term', admissible: false },
			{ type: 'select', value_type: 'term', admissible: true },
			{ type: 'select', value_type: 'number', admissible: false },
			{ type: 'radio', value_type: 'term', admissible: true },
			{ type: 'radio', value_type: 'string', admissible: false },
			// The only capture admitting two: a lone yes/no toggle, or a multi-pick over the
			// option rows
			{ type: 'checkbox', value_type: 'term', admissible: true },
			{ type: 'checkbox', value_type: 'boolean', admissible: true },
			{ type: 'checkbox', value_type: 'number', admissible: false },
		];

		cases.forEach(({ type, value_type, admissible }) => {
			it(`${admissible ? 'accepts' : 'rejects'} ${type} + ${value_type}`, () => {
				const isTerm =
					value_type === ProductCategoryAttributeValueTypeEnum.TERM;

				const validated = createWith({
					type,
					value_type,
					options: isTerm ? [{ term_id: mockId(12) }] : [],
				});

				withDebugValidated(() => {
					expect(validated.success).toBe(admissible);
				}, validated);
			});
		});
	});

	describe('unit', () => {
		it('accepts a unit on a numeric attribute', () => {
			const validated = numeric({ unit: 'ml' });

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});

		it('rejects a unit on anything else', () => {
			expect(createWith({ unit: 'ml' }).success).toBe(false);
		});

		// Both would give two answers to what follows the number
		it('rejects a unit alongside a suffix', () => {
			expect(numeric({ unit: 'ml', suffix: 'pcs' }).success).toBe(false);
		});

		it('accepts a suffix on its own', () => {
			expect(numeric({ suffix: 'pcs' }).success).toBe(true);
		});

		it('rejects a unit outside MeasureUnitEnum', () => {
			expect(numeric({ unit: 'furlong' }).success).toBe(false);
		});
	});

	describe('bounds', () => {
		it('accepts bounds on a numeric attribute', () => {
			expect(numeric({ min_value: 100, max_value: 3000 }).success).toBe(
				true,
			);
		});

		it('rejects bounds on anything else', () => {
			expect(createWith({ min_value: 100 }).success).toBe(false);
		});

		it('rejects a range that admits nothing', () => {
			expect(numeric({ min_value: 3000, max_value: 100 }).success).toBe(
				false,
			);
		});

		it('accepts a negative lower bound', () => {
			expect(numeric({ min_value: -40, max_value: 0 }).success).toBe(
				true,
			);
		});
	});

	describe('options', () => {
		it('rejects a term-backed definition with no admissible values', () => {
			expect(createWith({ options: [] }).success).toBe(false);
		});

		// Its restriction is a range, which is what bounds a measurement and leaves the number
		// in `value_numeric` where it stays filterable
		it('rejects options on a numeric definition', () => {
			expect(
				numeric({ options: [{ term_id: mockId(12) }] }).success,
			).toBe(false);
		});

		it('accepts an omitted options key on an update', () => {
			const validated = attributeValidator.update.safeParse({
				id: mockId(1),
				sort_order: 5,
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	describe('update', () => {
		it('rejects a payload carrying only the id', () => {
			expect(
				attributeValidator.update.safeParse({ id: mockId(1) }).success,
			).toBe(false);
		});

		// They are what a value is keyed on, so moving them would orphan every recorded value
		it('ignores category_id and attribute_label_id', () => {
			expect(
				attributeValidator.update.safeParse({
					id: mockId(1),
					category_id: mockId(9),
					attribute_label_id: mockId(9),
				}).success,
			).toBe(false);
		});

		it('accepts is_filterable false on its own', () => {
			const validated = attributeValidator.update.safeParse({
				id: mockId(1),
				is_filterable: false,
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	});

	describe('resolve', () => {
		it('wraps a single category id into a list', () => {
			const validated = attributeValidator.resolve.safeParse({
				category_id: mockId(5),
			});

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
				expect(validated.data?.category_id).toEqual([mockId(5)]);
			}, validated);
		});

		it('rejects an empty category list', () => {
			expect(
				attributeValidator.resolve.safeParse({ category_id: [] })
					.success,
			).toBe(false);
		});
	});
});
