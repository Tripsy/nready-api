import type CarrierEntity from '@/features/carrier/carrier.entity';
import {
	CarrierValidator,
	OrderByEnum,
} from '@/features/carrier/carrier.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const carrierValidator = new CarrierValidator('carrier');

export function getCarrierEntityMock(): CarrierEntity {
	return {
		id: mockId(1),
		name: 'Fun Drive',
		website: 'http://www.fundrive.dev',
		phone: '0722123456',
		email: 'fundrive@sample.com',
		notes: 'Test carrier entry',
		created_at: createPastDate(28800),
		updated_at: null,
		deleted_at: null,
	};
}

export const carrierInputPayloads = {
	create: {
		name: 'Fun Drive',
		website: 'http://www.fundrive.dev',
		phone: '0722123456',
		email: 'fundrive@sample.com',
		notes: 'Test carrier entry',
	},
	update: {
		id: mockId(1),
		name: 'Fun Drive Update',
		website: 'http://www.fundrive.dev',
		phone: '0722123456',
		email: 'fundrive@sample.com',
		notes: 'Test carrier entry',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'test',
			is_deleted: true,
		},
	},
};

export const carrierOutputPayloads = {
	create: carrierValidator.create.parse(carrierInputPayloads.create),
	update: carrierValidator.update.parse(carrierInputPayloads.update),
	find: carrierValidator.find.parse(carrierInputPayloads.find),
};
