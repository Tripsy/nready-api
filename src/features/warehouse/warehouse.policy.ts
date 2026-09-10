import WarehouseEntity from '@/features/warehouse/warehouse.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class WarehousePolicy extends PolicyAbstract {
	constructor() {
		const entity = WarehouseEntity.NAME;

		super(entity);
	}
}

export const warehousePolicy = new WarehousePolicy();
