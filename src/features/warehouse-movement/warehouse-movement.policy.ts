import WarehouseMovementEntity from '@/features/warehouse-movement/warehouse-movement.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

/**
 * Read-only: the ledger is written by the documents that move stock and by nothing a person
 * sends, so only `read` and `find` are ever checked.
 */
export class WarehouseMovementPolicy extends PolicyAbstract {
	constructor() {
		super(WarehouseMovementEntity.NAME);
	}
}

export const warehouseMovementPolicy = new WarehouseMovementPolicy();
