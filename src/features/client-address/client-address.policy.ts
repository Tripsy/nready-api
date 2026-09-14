import ClientAddressEntity from '@/features/client-address/client-address.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

export class ClientAddressPolicy extends PolicyAbstract {
	constructor() {
		const entity = ClientAddressEntity.NAME;

		super(entity);
	}
}

export const clientAddressPolicy = new ClientAddressPolicy();
