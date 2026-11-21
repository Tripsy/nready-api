import StockAdjustmentEntity, {
	StockAdjustmentDirectionEnum,
	StockAdjustmentReasonEnum,
	StockAdjustmentStatusEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import {
	OrderByEnum,
	StockAdjustmentValidator,
} from '@/features/warehouse-movement/stock-adjustment.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const stockAdjustmentValidator = new StockAdjustmentValidator(
	'warehouse-movement',
);

/** A removal of damaged goods. Built as an entity instance, so `StockAdjustmentEntity.NAME` resolves. */
export function getStockAdjustmentEntityMock(
	overrides?: Partial<StockAdjustmentEntity>,
): StockAdjustmentEntity {
	return Object.assign(new StockAdjustmentEntity(), {
		id: mockId(4),
		reason: StockAdjustmentReasonEnum.DAMAGED,
		qty: -12,
		status: StockAdjustmentStatusEnum.CREATED,
		reversed_at: null,
		notes: 'Pallet dropped at unloading',
		warehouse_id: mockId(1),
		variant_id: mockId(6),
		created_at: createPastDate(3600),
		updated_at: null,
		deleted_at: null,
		...overrides,
	});
}

export const stockAdjustmentInputPayloads = {
	create: {
		warehouse_id: mockId(1),
		variant_id: mockId(6),
		direction: StockAdjustmentDirectionEnum.REMOVE,
		qty: 12,
		reason: StockAdjustmentReasonEnum.DAMAGED,
		notes: 'Pallet dropped at unloading',
	},
	reverse: {
		id: mockId(4),
	},
	read: {
		id: mockId(4),
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.CREATED_AT,
		direction: OrderDirectionEnum.DESC,
		filter: {
			warehouse_id: mockId(1),
			adjustment_direction: StockAdjustmentDirectionEnum.REMOVE,
			status: StockAdjustmentStatusEnum.CREATED,
		},
	},
};

export const stockAdjustmentOutputPayloads = {
	create: stockAdjustmentValidator.create.parse(
		stockAdjustmentInputPayloads.create,
	),
	find: stockAdjustmentValidator.find.parse(
		stockAdjustmentInputPayloads.find,
	),
};
