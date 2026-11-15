import VatRateEntity from '@/features/vat-rate/vat-rate.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class VatRatePolicy extends PolicyAbstract {
	constructor() {
		const entity = VatRateEntity.NAME;

		super(entity);
	}
}

export const vatRatePolicy = new VatRatePolicy();
