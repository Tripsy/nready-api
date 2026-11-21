import type DiscountEntity from '@/features/discount/discount.entity';
import {
	DiscountReasonEnum,
	DiscountScopeEnum,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';
import {
	DiscountValidator,
	OrderByEnum,
} from '@/features/discount/discount.validator';
import {
	createFutureDate,
	createPastDate,
	formatDate,
} from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

const discountValidator = new DiscountValidator('discount');

export function getDiscountEntityMock(): DiscountEntity {
	return {
		id: mockId(1),
		label: 'Black Friday Discount',
		scope: DiscountScopeEnum.CATEGORY,
		reason: DiscountReasonEnum.BIRTHDAY_DISCOUNT,
		reference: 'BF-2025',
		type: DiscountTypeEnum.AMOUNT,
		conditions: {
			min_order_value: 101,
			applicable_countries: ['RO'],
		},
		value: 25,
		created_at: createPastDate(86400),
		updated_at: createPastDate(43200),
		deleted_at: null,
		start_at: createFutureDate(14400),
		end_at: createFutureDate(28800),
		notes: 'Applied to all orders during January',
	};
}

export const discountInputPayloads = {
	create: {
		label: 'Black Friday Discount',
		scope: DiscountScopeEnum.ORDER,
		reason: DiscountReasonEnum.BIRTHDAY_DISCOUNT,
		reference: 'BF-2025',
		type: DiscountTypeEnum.AMOUNT,
		conditions: {
			min_order_value: 101,
			applicable_countries: ['RO'],
		},
		value: 25,
		start_at: formatDate(createFutureDate(14400)) as string,
		end_at: formatDate(createFutureDate(28800)) as string,
		notes: 'Applied to all orders during January',
	},
	update: {
		id: mockId(1),
		label: 'Black Friday Discount',
		scope: DiscountScopeEnum.ORDER,
		reason: DiscountReasonEnum.BIRTHDAY_DISCOUNT,
		reference: 'BF-2025',
		type: DiscountTypeEnum.AMOUNT,
		value: 25,
		conditions: {
			min_order_value: 101,
			applicable_countries: ['RO'],
		},
		start_at: formatDate(createFutureDate(14400)) as string,
		end_at: formatDate(createFutureDate(28800)) as string,
		notes: 'Applied to all orders during January',
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'test',
			scope: DiscountScopeEnum.CATEGORY,
			reason: DiscountReasonEnum.BIRTHDAY_DISCOUNT,
			type: DiscountTypeEnum.PERCENT,
			reference: 'test',
			start_at_start: formatDate(createPastDate(14400)),
			start_at_end: formatDate(createPastDate(7200)),
			is_deleted: true,
		},
	},
};

export const discountOutputPayloads = {
	create: discountValidator.create.parse(discountInputPayloads.create),
	update: discountValidator.update.parse(discountInputPayloads.update),
	find: discountValidator.find.parse(discountInputPayloads.find),
};
