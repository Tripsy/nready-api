import ClientAddressEntity, {
	ClientAddressTypeEnum,
} from '@/features/client-address/client-address.entity';
import {
	ClientAddressValidator,
	OrderByEnum,
} from '@/features/client-address/client-address.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const clientAddressValidator = new ClientAddressValidator('client-address');

export function getClientAddressEntityMock(): ClientAddressEntity {
	return Object.assign(new ClientAddressEntity(), {
		id: 1,
		client_id: 1,
		address_id: 1,
		type: ClientAddressTypeEnum.DELIVERY,
		details: 'Ap. 12, floor 3',
		notes: 'Ring twice, entrance from the back',
		created_at: createPastDate(28800),
		updated_at: null,
	});
}

export const clientAddressInputPayloads = {
	create: {
		client_id: 1,
		address_id: 1,
		type: ClientAddressTypeEnum.DELIVERY,
		details: 'Ap. 12, floor 3',
		notes: 'Ring twice, entrance from the back',
	},
	update: {
		id: 1,
		type: ClientAddressTypeEnum.BILLING,
		details: 'Ap. 14, floor 4',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			client_id: 1,
			type: ClientAddressTypeEnum.DELIVERY,
			term: 'Florio',
		},
	},
};

export const clientAddressOutputPayloads = {
	create: clientAddressValidator.create.parse(
		clientAddressInputPayloads.create,
	),
	update: clientAddressValidator.update.parse(
		clientAddressInputPayloads.update,
	),
	find: clientAddressValidator.find.parse(clientAddressInputPayloads.find),
};
