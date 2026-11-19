import type { warehouseMovementController } from '@/features/warehouse-movement/warehouse-movement.controller';
import {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import { OrderByEnum } from '@/features/warehouse-movement/warehouse-movement.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const entitySample = {
	id: 1,
	created_at: '2026-10-01T10:00:00.000Z',
	movement_type: WarehouseMovementTypeEnum.RECEIPT,
	qty: 10,
	unit_cost_base: 12.5,
	source_type: WarehouseMovementSourceEnum.GRN_ITEM,
	source_id: 1,
	occurred_at: '2026-10-01T00:00:00.000Z',
	notes: null,
	warehouse_id: 1,
	variant_id: 1,
	grn_item_id: 1,
	reversal_of_id: null,
	// Joined names - null when the variant has been deleted since
	warehouse: { id: 1, code: 'BUC-01', name: 'Bucharest Central' },
	variant: { id: 1, sku: 'TSH-SOL-M-RED', product_id: 47 },
};

const ledgerNote =
	'Append-only: rows are posted by the documents that move stock - a confirmed goods receipt posts a receipt per line, canceling it posts an adjustment per line with reversal_of_id pointing at the receipt; a delivery shipping posts a sale per lot drawn (oldest lot first, source shipping_line), one coming back undelivered a sale_return reversing each, and a client return arriving a sale_return per lot it goes back into (source the return line, followed by a write_off on the same lot when the line is damaged) - and never changed. qty is signed: positive brings stock in, negative takes it out. unit_cost_base is the lot cost in the base currency. The audit trail, not the balance: on-hand is grn_item.qty_remaining';

export const docs: Record<
	keyof typeof warehouseMovementController,
	ApiInputDocumentation
> = {
	lowStock: helperApiInputDocumentation({
		description: 'List stock-tracked variants low on stock',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Low-stock variants',
			dataSample: {
				entries: [
					{
						variant_id: 6,
						product_id: 3,
						sku: 'QUI-BT6',
						on_hand: 4,
						reserved: 2,
						available: 2,
						low_stock_threshold: 5,
					},
				],
				pagination: { page: 1, limit: 10, total: 1 },
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'Variants that track stock and carry a low_stock_threshold, listed when available (on hand in active warehouses less what live orders reserve) is at or under it - so a threshold of 0 lists a variant once nothing is left to sell. A variant with no threshold is never listed. Always lowest available first. The same list is mailed to the application address every morning while it is not empty',
			query: {
				page: { type: 'number', required: false },
				limit: { type: 'number', required: false },
			},
		},
	}),

	stock: helperApiInputDocumentation({
		description: 'Get the stock of one variant',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Variant stock',
			dataSample: {
				variant_id: 1,
				on_hand: 18,
				reserved: 5,
				available: 13,
				warehouses: [
					{
						warehouse_id: 1,
						code: 'WH-01',
						name: 'Main warehouse',
						status: 'active',
						on_hand: 18,
					},
				],
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'on_hand is the sum of open lots on confirmed receipts in active warehouses - an inactive warehouse is listed but not counted. reserved is what live pending and confirmed orders hold; it is taken when an order is placed, restated when its lines are edited, lowered as its deliveries ship (given back if one returns) and released when it is canceled or completed. available = on_hand - reserved, and goes negative when a canceled receipt took back stock already promised. A variant that does not track stock reads 0 everywhere and is never refused',
			params: {
				variant_id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),

	read: helperApiInputDocumentation({
		description: 'Get one stock movement',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Stock movement details',
			dataSample: entitySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: ledgerNote,
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),

	find: helperApiInputDocumentation({
		description: 'List stock movements',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Stock movements',
			dataSample: {
				entries: [entitySample],
				pagination: { page: 1, limit: 10, total: 1 },
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `${ledgerNote}. filter[reversal_of_id] finds the row that canceled a given movement; source_type with source_id finds what one document line caused`,
			query: {
				page: { type: 'number', required: false },
				limit: { type: 'number', required: false },
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
				},
				'filter[warehouse_id]': { type: 'number', required: false },
				'filter[variant_id]': { type: 'number', required: false },
				'filter[grn_item_id]': { type: 'number', required: false },
				'filter[movement_type]': {
					type: 'enum',
					required: false,
					values: Object.values(WarehouseMovementTypeEnum),
				},
				'filter[source_type]': {
					type: 'enum',
					required: false,
					values: Object.values(WarehouseMovementSourceEnum),
				},
				'filter[source_id]': { type: 'number', required: false },
				'filter[reversal_of_id]': { type: 'number', required: false },
				'filter[occurred_at_start]': {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
				'filter[occurred_at_end]': {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
			},
		},
	}),
};
