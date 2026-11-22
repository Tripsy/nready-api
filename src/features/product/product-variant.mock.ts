import type ProductVariantEntity from '@/features/product/product-variant.entity';
import { OrderByEnum } from '@/features/product/product-variant.validator';
import { createPastDate } from '@/helpers/date.helper';
import { OrderDirectionEnum } from '@/shared/abstracts/entity.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

/**
 * One listing row as the query builds it: the variant's own columns, plus the slice of its
 * product the listing shows and the prices it is quoted at.
 *
 * `product` and `prices` are declared optional-or-joined on the entity and only populated when a
 * read asks for them, so the shape is cast rather than assembled from full entities - a
 * fabricated product row here would be a shape no response ever carries.
 */
export function getProductVariantEntityMock(): ProductVariantEntity {
	return {
		id: mockId(41),
		product_id: mockId(17),
		sku: 'PIZZA-MARG-30',
		barcode: '5941234567890',
		position: 0,
		is_default: true,
		track_stock: false,
		low_stock_threshold: null,
		allow_backorder: false,
		cost_price: 12.4,
		created_at: createPastDate(86400),
		updated_at: null,
		deleted_at: null,
		product: {
			id: mockId(17),
			workflow: 'ready',
			sale_status: 'available',
			type: 'physical',
			composition: 'simple',
			unit: 'piece',
			vat_category: 'standard',
			brand_id: mockId(3),
			deleted_at: null,
			brand: { id: mockId(3), name: 'Forno' },
			contents: [
				{
					language: 'en',
					slug: 'margherita-30',
					label: 'Margherita 30cm',
				},
			],
		},
		prices: [{ id: mockId(88), currency: 'RON', sale_price: 34.5 }],
	} as unknown as ProductVariantEntity;
}

export const productVariantInputPayloads = {
	find: {
		page: 1,
		limit: 20,
		order_by: OrderByEnum.ID,
		direction: OrderDirectionEnum.DESC,
		filter: {
			term: 'PIZZA',
			language: 'en',
		},
	},
};
