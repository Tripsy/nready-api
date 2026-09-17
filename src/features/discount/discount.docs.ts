import { Configuration } from '@/config/settings.config';
import type { discountController } from '@/features/discount/discount.controller';
import {
	DiscountReasonEnum,
	DiscountScopeEnum,
	DiscountTypeEnum,
} from '@/features/discount/discount.entity';
import {
	discountInputPayloads,
	getDiscountEntityMock,
} from '@/features/discount/discount.mock';
import { OrderByEnum } from '@/features/discount/discount.validator';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';

export const docs: Record<
	keyof typeof discountController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Create a new discount',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount created successfully',
			dataSample: getDiscountEntityMock() as unknown as Record<
				string,
				unknown
			>,
		},
		withAuthErrors: true,
		withErrors: [400, 422],
		request: {
			notes: 'end_at must be after start_at when both are given; value must be 0-100 when type is percent',
			body: {
				label: { type: 'string', required: true },
				scope: {
					type: 'enum',
					required: true,
					values: Object.values(DiscountScopeEnum),
				},
				reason: {
					type: 'enum',
					required: true,
					values: Object.values(DiscountReasonEnum),
				},
				reference: { type: 'string', required: false },
				type: {
					type: 'enum',
					required: true,
					values: Object.values(DiscountTypeEnum),
				},
				conditions: {
					type: 'object',
					required: false,
					format: '{ hour_range?: [number, number]; day_range?: [number, number]; min_order_value?: number; applicable_countries?: string[] (ISO 3166-1 alpha-2, e.g. RO) }',
				},
				value: {
					type: 'number',
					required: true,
					condition:
						'positive, max 2 decimals; 0-100 when type is percent',
				},
				start_at: {
					type: 'string',
					format: 'date-time',
					required: false,
				},
				end_at: {
					type: 'string',
					format: 'date-time',
					required: false,
				},
				notes: { type: 'string', required: false },
			},
			sample: discountInputPayloads.create,
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Get discount details',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount details',
			dataSample: getDiscountEntityMock() as unknown as Record<
				string,
				unknown
			>,
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Update discount',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount updated successfully',
			dataSample: getDiscountEntityMock() as unknown as Record<
				string,
				unknown
			>,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			notes: 'Provide at least one body parameter; end_at must be after start_at when both are given; value must be 0-100 when type is percent',
			body: {
				label: { type: 'string', required: false },
				scope: {
					type: 'enum',
					required: false,
					values: Object.values(DiscountScopeEnum),
				},
				reason: {
					type: 'enum',
					required: false,
					values: Object.values(DiscountReasonEnum),
				},
				reference: { type: 'string', required: false },
				type: {
					type: 'enum',
					required: false,
					values: Object.values(DiscountTypeEnum),
				},
				conditions: {
					type: 'object',
					required: false,
					format: '{ hour_range?: [number, number]; day_range?: [number, number]; min_order_value?: number; applicable_countries?: string[] (ISO 3166-1 alpha-2, e.g. RO) }',
				},
				value: {
					type: 'number',
					required: false,
					condition:
						'positive, max 2 decimals; 0-100 when type is percent',
				},
				start_at: {
					type: 'string',
					format: 'date-time',
					required: false,
				},
				end_at: {
					type: 'string',
					format: 'date-time',
					required: false,
				},
				notes: { type: 'string', required: false },
			},
			sample: discountInputPayloads.update,
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Delete discount',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount deleted with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	restore: helperApiInputDocumentation({
		description: 'Restore discount',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount restored with success',
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	readTargets: helperApiInputDocumentation({
		description:
			'List the entities a discount is linked to, grouped by scope. Scopes with no links are omitted',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount targets retrieved with success',
			dataSample: { client: [3, 9], category: [12] },
		},
		withAuthErrors: true,
		withErrors: [404],
		request: {
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
		},
	}),
	updateTargets: helperApiInputDocumentation({
		description:
			'Replace the entities a discount is linked to. Only the scopes present in the body are touched; an empty array clears that scope',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount targets updated with success',
			dataSample: { client: [3, 9], category: [12] },
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: 'A discount with scope `shipping` accepts `client` targets only - any other non-empty type answers 400, judged against the set as it will stand after the call. With no targets a shipping discount applies to every buyer; with client targets, to those clients alone',
			params: {
				id: {
					type: 'number',
					required: true,
				},
			},
			body: {
				client: {
					type: 'array',
					required: false,
					format: 'number[]',
				},
				variant: {
					type: 'array',
					required: false,
					format: 'number[]',
				},
				product: {
					type: 'array',
					required: false,
					format: 'number[]',
				},
				category: {
					type: 'array',
					required: false,
					format: 'number[]',
				},
				brand: {
					type: 'array',
					required: false,
					format: 'number[]',
				},
			},
		},
	}),
	find: helperApiInputDocumentation({
		description: 'Get discounts',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Discount list',
			dataSample: {
				entries: [],
				pagination: {
					page: 1,
					limit: 5,
					total: 0,
				},
				query: {
					order_by: 'id',
					direction: 'DESC',
					limit: 5,
					page: 1,
					filter: {
						term: 'zone.ro',
						is_deleted: true,
					},
				},
			},
		},
		withAuthErrors: true,
		request: {
			query: {
				page: {
					type: 'number',
					required: false,
					default: 1,
				},
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
					default: OrderDirectionEnum.ASC,
				},
				filter: {
					id: {
						type: 'number',
						required: false,
					},
					term: {
						type: 'string',
						required: false,
					},
					scope: {
						type: 'enum',
						required: false,
						values: Object.values(DiscountScopeEnum),
					},
					reason: {
						type: 'enum',
						required: false,
						values: Object.values(DiscountReasonEnum),
					},
					type: {
						type: 'enum',
						required: false,
						values: Object.values(DiscountTypeEnum),
					},
					start_at_start: {
						type: 'string',
						format: 'date-time',
						required: false,
					},
					start_at_end: {
						type: 'string',
						format: 'date-time',
						required: false,
					},
					is_deleted: {
						type: 'boolean',
						required: false,
						default: false,
					},
				},
			},
		},
	}),
};
