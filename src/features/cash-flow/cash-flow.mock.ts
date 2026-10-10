import type CashFlowEntity from '@/features/cash-flow/cash-flow.entity';
import {
	CashFlowCategoryTypeEnum,
	CashFlowDirectionEnum,
	CashFlowMethodEnum,
	CashFlowStatusEnum,
} from '@/features/cash-flow/cash-flow.entity';
import {
	CashFlowValidator,
	OrderByEnum,
} from '@/features/cash-flow/cash-flow.validator';
import { CashFlowCategoryEnum } from '@/features/cash-flow/cash-flow-category.enum';
import { createPastDate, formatDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const cashFlowValidator = new CashFlowValidator('cash-flow');

export function getCashFlowEntityMock(
	overrides?: Partial<CashFlowEntity>,
): CashFlowEntity {
	return {
		id: 1,
		direction: CashFlowDirectionEnum.IN,
		category_type: CashFlowCategoryTypeEnum.REVENUE,
		category: CashFlowCategoryEnum.SALE,
		method: CashFlowMethodEnum.CASH,
		status: CashFlowStatusEnum.COMPLETED,
		amount: 10000, // $100.00 in cents
		net_amount: 100,
		gross_amount: 119,
		vat_rate: 19.0,
		currency: 'RON',
		exchange_rate: 1,
		external_reference: 'REF-12345',
		parent_id: null,
		notes: 'Test cash flow entry',
		created_at: createPastDate(28800),
		updated_at: null,
		deleted_at: null,
		refunds: [],
		operational_records: [],
		parent: null,
		...overrides,
	};
}

export function getCashFlowRefundEntityMock(
	overrides?: Partial<CashFlowEntity>,
): CashFlowEntity {
	return {
		id: 2,
		direction: CashFlowDirectionEnum.OUT,
		category_type: CashFlowCategoryTypeEnum.CORRECTION,
		category: CashFlowCategoryEnum.REFUND,
		method: CashFlowMethodEnum.BANK_TRANSFER,
		status: CashFlowStatusEnum.COMPLETED,
		amount: 5000, // $50.00 in cents (refund)
		net_amount: 50,
		gross_amount: 59.5,
		vat_rate: 19.0,
		currency: 'RON',
		exchange_rate: 1,
		external_reference: 'REF-12345-REFUND',
		parent_id: 1,
		notes: 'Refund for transaction #1',
		created_at: createPastDate(1000),
		updated_at: null,
		deleted_at: null,
		refunds: [],
		operational_records: [],
		parent: null,
		...overrides,
	};
}

export const cashFlowInputPayloads = {
	create: {
		direction: CashFlowDirectionEnum.IN,
		category_type: CashFlowCategoryTypeEnum.REVENUE,
		category: CashFlowCategoryEnum.SALE,
		method: CashFlowMethodEnum.CASH,
		amount: 10000,
		vat_rate: 19.0,
		currency: 'RON',
		external_reference: 'REF-12345',
		parent_id: null,
		notes: 'Test cash flow entry',
		operational_records: {
			client: 1,
			vendor: null,
			order: null,
		},
	},
	update: {
		id: 1,
		direction: CashFlowDirectionEnum.IN,
		category_type: CashFlowCategoryTypeEnum.REVENUE,
		category: CashFlowCategoryEnum.SALE,
		method: CashFlowMethodEnum.CREDIT_CARD,
		amount: 120000000,
		vat_rate: 19.0,
		currency: 'RON',
		external_reference: 'REF-12345',
		notes: 'Updated cash flow entry',
	},
	delete: {
		force: false,
	},
	find: {
		page: 1,
		limit: 10,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			id: 1,
			direction: CashFlowDirectionEnum.IN,
			category_type: CashFlowCategoryTypeEnum.REVENUE,
			category: CashFlowCategoryEnum.SALE,
			method: CashFlowMethodEnum.CASH,
			status: CashFlowStatusEnum.COMPLETED,
			create_at_start: formatDate(createPastDate(30000)),
			create_at_end: formatDate(createPastDate(10000)),
			term: 'test',
			is_deleted: false,
		},
	},
};

export const cashFlowOutputPayloads = {
	create: cashFlowValidator.create.parse(cashFlowInputPayloads.create),
	update: cashFlowValidator.update.parse(cashFlowInputPayloads.update),
	find: cashFlowValidator.find.parse(cashFlowInputPayloads.find),
};
