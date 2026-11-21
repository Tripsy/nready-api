import { expect, jest } from '@jest/globals';
import {
	StockAdjustmentDirectionEnum,
	StockAdjustmentReasonEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import { stockAdjustmentInputPayloads } from '@/features/warehouse-movement/stock-adjustment.mock';
import { StockAdjustmentValidator } from '@/features/warehouse-movement/stock-adjustment.validator';
import { withDebugValidated } from '@/tests/jest-validator.setup';

beforeEach(() => {
	jest.restoreAllMocks();
});

const validator = new StockAdjustmentValidator('warehouse-movement');

const schemas = ['create', 'reverse', 'read', 'find'] as const;

const createWith = (overrides: Record<string, unknown>) =>
	validator.create.safeParse({
		...stockAdjustmentInputPayloads.create,
		...overrides,
	});

describe('StockAdjustmentValidator', () => {
	for (const schemaName of schemas) {
		it(`${schemaName}() accepts valid payload`, () => {
			const validated = validator[schemaName].safeParse(
				stockAdjustmentInputPayloads[schemaName],
			);

			withDebugValidated(() => {
				expect(validated.success).toBe(true);
			}, validated);
		});
	}

	it('refuses a quantity of zero, a negative one and more than two decimals', () => {
		for (const qty of [0, -3, 1.234]) {
			expect(createWith({ qty }).success).toBe(false);
		}
	});

	it('refuses a missing direction', () => {
		expect(createWith({ direction: undefined }).success).toBe(false);
	});

	it('accepts audit either way', () => {
		for (const direction of Object.values(StockAdjustmentDirectionEnum)) {
			expect(
				createWith({
					direction,
					reason: StockAdjustmentReasonEnum.AUDIT,
				}).success,
			).toBe(true);
		}
	});

	it('refuses a reason that belongs to the other direction', () => {
		expect(
			createWith({
				direction: StockAdjustmentDirectionEnum.ADD,
				reason: StockAdjustmentReasonEnum.DAMAGED,
			}).success,
		).toBe(false);
		expect(
			createWith({
				direction: StockAdjustmentDirectionEnum.REMOVE,
				reason: StockAdjustmentReasonEnum.FOUND,
			}).success,
		).toBe(false);
	});
});
