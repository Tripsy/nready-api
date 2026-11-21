import StockAdjustmentEntity from '@/features/warehouse-movement/stock-adjustment.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

/**
 * `create` posts an adjustment, `delete` reverses one - the nearest CRUD meaning, and it
 * keeps undoing apart from posting: an operator trusted to record breakage need not be trusted
 * to erase someone else's. `read` and `find` list them.
 */
export class StockAdjustmentPolicy extends PolicyAbstract {
	constructor() {
		super(StockAdjustmentEntity.NAME);
	}
}

export const stockAdjustmentPolicy = new StockAdjustmentPolicy();
