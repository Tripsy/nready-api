import { expect } from '@jest/globals';
import type ProductBundleItemEntity from '@/features/product/product-bundle-item.entity';
import type { LoadedComposition } from '@/features/product/product-bundle-selection.service';
import {
	bundleStatus,
	ProductStockStatusEnum,
	toStockStatus,
} from '@/features/product/product-stock.service';
import type { VariantAvailability } from '@/shared/registries/stock-availability.registry';
import type { EntityId } from '@/shared/types/entity-id.type';
import { mockId } from '@/tests/mocks/uuid.mock';

function item(
	id: EntityId,
	variantId: EntityId,
	quantity: number,
	groupId: EntityId | null = null,
): ProductBundleItemEntity {
	return {
		id,
		variant_id: variantId,
		quantity,
		group_id: groupId,
		is_optional: false,
	} as ProductBundleItemEntity;
}

function composition(
	mandatory: ProductBundleItemEntity[],
	groups: ProductBundleItemEntity[][] = [],
	optional: ProductBundleItemEntity[] = [],
): LoadedComposition {
	return {
		mandatory,
		optional,
		candidatesByGroup: new Map(
			groups.map((candidates, index) => [mockId(index + 1), candidates]),
		),
		byId: new Map(),
	};
}

function stock(
	available: number,
	overrides: Partial<VariantAvailability> = {},
): VariantAvailability {
	return {
		available,
		allow_backorder: false,
		low_stock_threshold: null,
		...overrides,
	};
}

describe('toStockStatus', () => {
	it.each([
		// available, threshold, backorder, expected
		[25, 10, false, ProductStockStatusEnum.IN_STOCK],
		[11, 10, false, ProductStockStatusEnum.IN_STOCK],
		[10, 10, false, ProductStockStatusEnum.LOW_STOCK],
		[1, 10, false, ProductStockStatusEnum.LOW_STOCK],
		[1, null, false, ProductStockStatusEnum.IN_STOCK],
		[0.5, 10, false, ProductStockStatusEnum.OUT_OF_STOCK],
		[0, 10, false, ProductStockStatusEnum.OUT_OF_STOCK],
		[-3, null, false, ProductStockStatusEnum.OUT_OF_STOCK],
		[0, 10, true, ProductStockStatusEnum.BACKORDER],
		[5, 10, true, ProductStockStatusEnum.LOW_STOCK],
	] as const)(
		'%d available, threshold %s, backorder %s -> %s',
		(available, threshold, backorder, expected) => {
			expect(
				toStockStatus(
					stock(available, {
						low_stock_threshold: threshold,
						allow_backorder: backorder,
					}),
				),
			).toBe(expected);
		},
	);

	it('counts none left in whole bundles - 3 units at 4 per bundle is out', () => {
		expect(toStockStatus(stock(3), 4)).toBe(
			ProductStockStatusEnum.OUT_OF_STOCK,
		);
	});
});

describe('bundleStatus', () => {
	it('is null when no component tracks stock', () => {
		expect(
			bundleStatus(
				composition([item(mockId(1), mockId(10), 1)]),
				new Map(),
			),
		).toBeNull();
	});

	it('reads low in the component units against its own threshold', () => {
		expect(
			bundleStatus(
				composition([item(mockId(1), mockId(10), 2)]),
				new Map([[mockId(10), stock(15, { low_stock_threshold: 20 })]]),
			),
		).toBe(ProductStockStatusEnum.LOW_STOCK);
	});

	it('takes the worst always-included component', () => {
		expect(
			bundleStatus(
				composition([
					item(mockId(1), mockId(10), 1),
					item(mockId(2), mockId(11), 1),
				]),
				new Map([
					[mockId(10), stock(50)],
					[mockId(11), stock(0)],
				]),
			),
		).toBe(ProductStockStatusEnum.OUT_OF_STOCK);
	});

	it('takes the best candidate of a choice', () => {
		expect(
			bundleStatus(
				composition(
					[item(mockId(1), mockId(10), 1)],
					[
						[
							item(mockId(2), mockId(11), 1, mockId(1)),
							item(mockId(3), mockId(12), 1, mockId(1)),
						],
					],
				),
				new Map([
					[mockId(10), stock(50)],
					[mockId(11), stock(0)],
					[mockId(12), stock(40)],
				]),
			),
		).toBe(ProductStockStatusEnum.IN_STOCK);
	});

	it('is out of stock when every candidate of a choice is gone', () => {
		expect(
			bundleStatus(
				composition(
					[item(mockId(1), mockId(10), 1)],
					[
						[
							item(mockId(2), mockId(11), 1, mockId(1)),
							item(mockId(3), mockId(12), 1, mockId(1)),
						],
					],
				),
				new Map([
					[mockId(10), stock(50)],
					[mockId(11), stock(0)],
					[mockId(12), stock(0)],
				]),
			),
		).toBe(ProductStockStatusEnum.OUT_OF_STOCK);
	});

	it('lets an untracked candidate satisfy its choice', () => {
		expect(
			bundleStatus(
				composition(
					[],
					[
						[
							item(mockId(2), mockId(11), 1, mockId(1)),
							item(mockId(3), mockId(12), 1, mockId(1)),
						],
					],
				),
				new Map([[mockId(11), stock(0)]]),
			),
		).toBeNull();
	});

	it('never lets an optional component hold the bundle back', () => {
		expect(
			bundleStatus(
				composition(
					[item(mockId(1), mockId(10), 1)],
					[],
					[item(mockId(4), mockId(13), 1)],
				),
				new Map([
					[mockId(10), stock(50)],
					[mockId(13), stock(0)],
				]),
			),
		).toBe(ProductStockStatusEnum.IN_STOCK);
	});
});
