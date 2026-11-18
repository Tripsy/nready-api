import { Configuration } from '@/config/settings.config';
import type { grnController } from '@/features/grn/grn.controller';
import { GrnStatusEnum, STATUS_TRANSITIONS } from '@/features/grn/grn.entity';
import {
	GRN_ITEMS_MAX,
	GRN_LOT_CODE_MAX,
	GRN_NOTES_MAX,
	GRN_SUPPLIER_DOCUMENT_MAX,
	OrderByEnum,
	paramsUpdateList,
} from '@/features/grn/grn.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

/** Written out: the feature has no mock, and a receipt is read with its lines attached. */
const itemSample: Record<string, unknown> = {
	id: 11,
	grn_id: 4,
	variant_id: 27,
	qty: 40,
	qty_remaining: 40,
	unit_cost: 12.5,
	unit_cost_base: 12.5,
	vat_rate: 21,
	lot_code: 'B-2026-118',
	expires_at: '2027-05-31',
	notes: null,
	sku: 'OXF-M-BLUE',
	label: 'Oxford shirt',
	created_at: '2026-11-10T08:30:00.000Z',
	updated_at: null,
	deleted_at: null,
};

const entrySample: Record<string, unknown> = {
	id: 4,
	ref_code: 'NIR',
	ref_number: 4,
	supplier_document_number: 'AVZ 004512',
	status: GrnStatusEnum.CONFIRMED,
	received_at: '2026-11-10T00:00:00.000Z',
	confirmed_at: '2026-11-10T09:02:00.000Z',
	currency: 'RON',
	exchange_rate: 1,
	notes: null,
	warehouse_id: 1,
	vendor_id: 3,
	warehouse: { id: 1, code: 'MAIN', name: 'Main warehouse' },
	vendor: { id: 3, name: 'Parts SRL 4' },
	created_at: '2026-11-10T08:30:00.000Z',
	updated_at: '2026-11-10T09:02:00.000Z',
	deleted_at: null,
};

/** Rendered as `draft -> confirmed | canceled`, one hop per entry. */
const statusTransitionNote = Object.entries(STATUS_TRANSITIONS)
	.map(([from, to]) => `${from} -> ${to.length ? to.join(' | ') : '(none)'}`)
	.join('; ');

const itemsParam = {
	type: 'array' as const,
	required: false,
	format: '[{ variant_id: number; qty: number; unit_cost: number; vat_rate?: number; lot_code?: string; expires_at?: string; notes?: string }]',
	condition: `at most ${GRN_ITEMS_MAX} lines, one per variant; every variant must exist and track stock. \`qty\` and \`unit_cost\` take 2 decimals, \`unit_cost\` may be 0, \`lot_code\` up to ${GRN_LOT_CODE_MAX} characters, \`expires_at\` a YYYY-MM-DD day`,
};

const headerBody = {
	warehouse_id: { type: 'number' as const, required: true },
	vendor_id: { type: 'number' as const, required: true },
	supplier_document_number: {
		type: 'string' as const,
		required: false,
		condition: `the supplier's delivery note or invoice number, up to ${GRN_SUPPLIER_DOCUMENT_MAX} characters`,
	},
	received_at: {
		type: 'string' as const,
		required: true,
		format: 'YYYY-MM-DD',
		condition: 'when the goods physically arrived; orders the FIFO pick',
	},
	currency: {
		type: 'string' as const,
		required: true,
		condition: 'ISO 4217 code the supplier invoiced in',
	},
	exchange_rate: {
		type: 'number' as const,
		required: false,
		condition:
			'rate to the base currency, 6 decimals; left out it is the published rate of the receiving day. Always 1 for the base currency',
	},
	notes: {
		type: 'string' as const,
		required: false,
		condition: `up to ${GRN_NOTES_MAX} characters`,
	},
	items: itemsParam,
};

const idParams = {
	id: { type: 'number' as const, required: true },
};

/**
 * A receipt is a draft until confirmed, and only confirmation moves stock - so the docs say, per
 * action, what the status allows.
 */
export const docs: Record<keyof typeof grnController, ApiInputDocumentation> = {
	create: helperApiInputDocumentation({
		description: 'Create a goods receipt (draft)',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Goods receipt created successfully',
			dataSample: entrySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: "A new receipt is a `draft`: its number is allocated from the GRN series, and no stock moves until it is confirmed through the status route. Lines may be sent now or added later through an update. Each line's cost is converted into the base currency at the receipt's rate and frozen as `unit_cost_base`",
			body: headerBody,
			sample: {
				warehouse_id: 1,
				vendor_id: 3,
				supplier_document_number: 'AVZ 004512',
				received_at: '2026-11-10',
				currency: 'RON',
				items: [
					{
						variant_id: 27,
						qty: 40,
						unit_cost: 12.5,
						vat_rate: 21,
						lot_code: 'B-2026-118',
					},
				],
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get goods receipt details, with its lines',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Goods receipt details',
			dataSample: { ...entrySample, items: [itemSample] },
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			notes: '`qty_remaining` is what is still in each lot - 0 on a draft, `qty` right after confirmation, drawn down as stock leaves. A deleted receipt is only visible to a caller holding grn delete',
			params: idParams,
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update goods receipt',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Goods receipt updated successfully',
			dataSample: entrySample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Provide at least one of ${paramsUpdateList.join(', ')}. A draft takes any of them; \`items\` replaces the whole line set, and changing the currency or the receiving day re-resolves the rate and re-converts every line. A confirmed receipt accepts only \`supplier_document_number\` and \`notes\` (409 otherwise); a canceled one accepts nothing`,
			params: idParams,
			body: Object.fromEntries(
				Object.entries(headerBody).map(([key, param]) => [
					key,
					{ ...param, required: false },
				]),
			),
			sample: {
				supplier_document_number: 'AVZ 004513',
				notes: 'Two cartons damaged on arrival, accepted at full cost',
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete goods receipt',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Goods receipt deleted successfully',
		},
		withAuthErrors: true,
		withErrors: [404, 409],
		request: {
			notes: 'Soft delete, for a draft or a canceled receipt. A confirmed receipt holds open lots and answers 409 - cancel it instead',
			params: idParams,
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore goods receipt',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Goods receipt restored successfully',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: idParams,
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get goods receipts',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Goods receipt list',
			dataSample: {
				entries: [entrySample],
				pagination: { page: 1, limit: 10, total: 1 },
				query: {
					order_by: OrderByEnum.ID,
					direction: OrderDirectionEnum.DESC,
					limit: 10,
					page: 1,
					filter: {
						status: GrnStatusEnum.CONFIRMED,
						is_deleted: false,
					},
				},
			},
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			query: {
				page: { type: 'number', required: false, default: 1 },
				limit: {
					type: 'number',
					required: false,
					default: Configuration.get('filter.limit'),
				},
				order_by: {
					type: 'enum',
					required: false,
					values: Object.values(OrderByEnum),
					default: OrderByEnum.ID,
				},
				direction: {
					type: 'enum',
					required: false,
					values: Object.values(OrderDirectionEnum),
					default: OrderDirectionEnum.DESC,
				},
				filter: {
					id: { type: 'number', required: false },
					warehouse_id: { type: 'number', required: false },
					vendor_id: { type: 'number', required: false },
					status: {
						type: 'enum',
						required: false,
						values: Object.values(GrnStatusEnum),
					},
					received_at_start: {
						type: 'string',
						required: false,
						format: 'YYYY-MM-DD',
					},
					received_at_end: {
						type: 'string',
						required: false,
						format: 'YYYY-MM-DD',
					},
					term: {
						type: 'string',
						required: false,
						condition: `a number matches the receipt number or id; a written reference (\`NIR-42\`) the series and number; anything else from ${Configuration.get('filter.termMinLength')} characters the supplier document number`,
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
						condition:
							'only takes effect for a caller holding grn delete',
					},
				},
			},
			sample: {
				page: 1,
				limit: 10,
				order_by: OrderByEnum.RECEIVED_AT,
				direction: OrderDirectionEnum.DESC,
				filter: { warehouse_id: 1, status: GrnStatusEnum.DRAFT },
			},
		},
	}),
	statusUpdate: helperApiInputDocumentation({
		description: 'Confirm or cancel a goods receipt',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Goods receipt status updated successfully',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 409, 422],
		request: {
			notes: `Allowed transitions: ${statusTransitionNote}. Confirming opens each line's lot, posts a receipt movement per line (when warehouse-movement is installed) and re-averages each variant's \`cost_price\` against the stock on hand across every warehouse; it answers 409 for a receipt with no lines. Canceling a draft changes nothing else; canceling a confirmed receipt posts a reversing movement per line (likewise) and takes the lot back out of the average - refused with 409 once any lot has been drawn from. Asking for the current status answers 400`,
			params: {
				...idParams,
				status: {
					type: 'enum',
					required: true,
					values: Object.values(GrnStatusEnum),
				},
			},
		},
	}),
};
