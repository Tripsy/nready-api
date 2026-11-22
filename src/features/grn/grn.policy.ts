import GrnEntity from '@/features/grn/grn.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class GrnPolicy extends PolicyAbstract {
	constructor() {
		const entity = GrnEntity.NAME;

		super(entity);
	}
}

export const grnPolicy = new GrnPolicy();
