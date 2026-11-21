import type { stockAdjustmentController } from '@/features/warehouse-movement/stock-adjustment.controller';
import {
	STOCK_ADJUSTMENT_REASONS,
	StockAdjustmentDirectionEnum,
	StockAdjustmentReasonEnum,
	StockAdjustmentStatusEnum,
} from '@/features/warehouse-movement/stock-adjustment.entity';
import { OrderByEnum } from '@/features/warehouse-movement/stock-adjustment.validator';
import {
	WarehouseMovementSourceEnum,
	WarehouseMovementTypeEnum,
} from '@/features/warehouse-movement/warehouse-movement.entity';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

const listSample = {
	id: 4,
	reason: StockAdjustmentReasonEnum.DAMAGED,
	qty: -12,
	status: StockAdjustmentStatusEnum.CREATED,
	reversed_at: null,
	notes: 'Pallet dropped at unloading',
	warehouse_id: 1,
	variant_id: 6,
	created_at: '2026-11-20T09:30:00.000Z',
	updated_at: '2026-11-20T09:30:00.000Z',
	// Joined names - null when the variant has been deleted since
	warehouse: { id: 1, code: 'BUC-01', name: 'Bucharest Central' },
	variant: { id: 6, sku: 'QUI-BT6', product_id: 5 },
};

const entrySample = {
	...listSample,
	movements: [
		{
			id: 61,
			movement_type: WarehouseMovementTypeEnum.WRITE_OFF,
			qty: -10,
			unit_cost_base: 41.2,
			source_type: WarehouseMovementSourceEnum.ADJUSTMENT,
			source_id: 4,
			grn_item_id: 8,
			reversal_of_id: null,
		},
		{
			id: 62,
			movement_type: WarehouseMovementTypeEnum.WRITE_OFF,
			qty: -2,
			unit_cost_base: 43.9,
			source_type: WarehouseMovementSourceEnum.ADJUSTMENT,
			source_id: 4,
			grn_item_id: 15,
			reversal_of_id: null,
		},
	],
};

const entryNote =
	"Stock added or removed by hand, with no document behind it. qty is the signed change posted - positive added, negative removed. movements are the ledger rows it posted, one per lot touched at that lot's cost (source_type adjustment, source_id this id), followed once reversed by the rows that undid each (reversal_of_id set). Never edited; a wrong figure is reversed and posted again";

export const docs: Record<
	keyof typeof stockAdjustmentController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Add or remove stock by hand, for a stated reason',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Adjustment posted',
			dataSample: entrySample,
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: `qty is positive; direction says which way. remove draws the units from the warehouse oldest lot first - the draw a shipment makes - and 409s when it holds fewer; it is posted as a write_off movement for a loss (damaged, expired, lost, theft, sample) and as an adjustment for an audit. add puts them into lots that have room - what they arrived with less what they hold - newest receipt first, at their own cost, posted as adjustment movements; 409 when that room is smaller, since a lot never holds more than it arrived with and the rest has to come in on a goods receipt. reason has to fit the direction - remove: ${STOCK_ADJUSTMENT_REASONS.remove.join(', ')}; add: ${STOCK_ADJUSTMENT_REASONS.add.join(', ')}. 422 when the warehouse is inactive or the variant does not track stock. Reservations are not checked: a removal records what happened, and may leave the variant promised beyond what it holds (available goes negative in the stock read). Needs stock-adjustment.create`,
			body: {
				warehouse_id: { type: 'number', required: true },
				variant_id: { type: 'number', required: true },
				direction: {
					type: 'enum',
					required: true,
					values: Object.values(StockAdjustmentDirectionEnum),
				},
				qty: {
					type: 'number',
					required: true,
					condition: '> 0, 2 decimals',
				},
				reason: {
					type: 'enum',
					required: true,
					values: Object.values(StockAdjustmentReasonEnum),
				},
				notes: {
					type: 'string',
					required: false,
					condition: 'max 2000 characters',
				},
			},
			sample: {
				warehouse_id: 1,
				variant_id: 6,
				direction: StockAdjustmentDirectionEnum.REMOVE,
				qty: 12,
				reason: StockAdjustmentReasonEnum.DAMAGED,
				notes: 'Pallet dropped at unloading',
			},
		},
	}),

	reverse: helperApiInputDocumentation({
		description: 'Reverse a stock adjustment',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Adjustment reversed',
			dataSample: {
				...entrySample,
				status: StockAdjustmentStatusEnum.REVERSED,
				reversed_at: '2026-11-20T10:05:00.000Z',
			},
		},
		withAuthErrors: true,
		withErrors: [404, 409, 422],
		request: {
			notes: 'Posts one opposing adjustment movement per row the adjustment posted (reversal_of_id set) and puts the units back where they were: removed units into the lots they left, added units out of the lots they went into. 409 when it is already reversed, or when a lot no longer holds the units a count added - stock drawn from it since; post a new count instead. Needs stock-adjustment.delete',
			params: {
				id: { type: 'number', required: true },
			},
		},
	}),

	read: helperApiInputDocumentation({
		description: 'Get one stock adjustment with its movements',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Stock adjustment details',
			dataSample: entrySample,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: entryNote,
			params: {
				id: { type: 'number', required: true },
			},
		},
	}),

	find: helperApiInputDocumentation({
		description: 'List stock adjustments',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Stock adjustments',
			dataSample: {
				entries: [listSample],
				pagination: { page: 1, limit: 10, total: 1 },
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: `${entryNote}. The list carries no movements - read one for them`,
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
				'filter[adjustment_direction]': {
					type: 'enum',
					required: false,
					values: Object.values(StockAdjustmentDirectionEnum),
				},
				'filter[reason]': {
					type: 'enum',
					required: false,
					values: Object.values(StockAdjustmentReasonEnum),
				},
				'filter[status]': {
					type: 'enum',
					required: false,
					values: Object.values(StockAdjustmentStatusEnum),
				},
				'filter[created_at_start]': {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
				'filter[created_at_end]': {
					type: 'string',
					required: false,
					condition: 'ISO 8601',
				},
			},
		},
	}),
};
