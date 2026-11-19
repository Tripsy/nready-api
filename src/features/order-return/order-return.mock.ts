import OrderReturnEntity, {
	OrderReturnReasonEnum,
	OrderReturnStatusEnum,
} from '@/features/order-return/order-return.entity';
import {
	OrderByEnum,
	OrderReturnValidator,
} from '@/features/order-return/order-return.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const orderReturnValidator = new OrderReturnValidator('order-return');

/**
 * A request still waiting on a decision. Built as an entity instance, not a literal, so a test
 * reaching for `OrderReturnEntity.NAME` through the row's constructor finds it.
 */
export function getOrderReturnEntityMock(
	overrides?: Partial<OrderReturnEntity>,
): OrderReturnEntity {
	return Object.assign(new OrderReturnEntity(), {
		id: 7,
		ref_code: 'RMA',
		ref_number: 7,
		status: OrderReturnStatusEnum.REQUESTED,
		reason: OrderReturnReasonEnum.WRONG_ITEM,
		customer_notes: 'Ordered M, received L',
		response: null,
		notes: null,
		decided_at: null,
		received_at: null,
		closed_at: null,
		reversal_invoice_ids: [],
		refund_shipping: false,
		order_id: 118,
		shipping_id: null,
		user_id: 42,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		...overrides,
	});
}

export const orderReturnInputPayloads = {
	create: {
		order_id: 118,
		reason: OrderReturnReasonEnum.WRONG_ITEM,
		customer_notes: 'Ordered M, received L',
		notes: 'Raised by phone',
		lines: [{ variant_id: 27, quantity: 1 }],
	},
	update: {
		id: 7,
		customer_notes: 'Ordered M, received L',
		response: 'Please pack the item in its original box',
		notes: 'Buyer called to confirm',
	},
	approve: {
		id: 7,
		carrier_id: 3,
		response: 'Approved - the courier will collect it',
		refund_shipping: true,
	},
	statusUpdate: {
		id: 7,
		status: OrderReturnStatusEnum.REJECTED,
		response: 'Outside the return window',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			order_id: 118,
			status: OrderReturnStatusEnum.REQUESTED,
			is_deleted: false,
		},
	},
	publicCreate: {
		order_id: 118,
		reason: OrderReturnReasonEnum.NO_LONGER_NEEDED,
		customer_notes: 'Changed my mind',
		lines: [{ variant_id: 27, quantity: 1 }],
	},
};

export const orderReturnOutputPayloads = {
	create: orderReturnValidator.create.parse(orderReturnInputPayloads.create),
	update: orderReturnValidator.update.parse(orderReturnInputPayloads.update),
	approve: orderReturnValidator.approve.parse(
		orderReturnInputPayloads.approve,
	),
	find: orderReturnValidator.find.parse(orderReturnInputPayloads.find),
	publicCreate: orderReturnValidator.publicCreate.parse(
		orderReturnInputPayloads.publicCreate,
	),
};
