import { In } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError } from '@/exceptions';
import type { ProductOptionSnapshot } from '@/features/product/product-option.entity';
import ProductOptionPriceEntity from '@/features/product/product-option-price.entity';
import {
	ProductOptionSelectionService,
	productOptionSelectionService,
} from '@/features/product/product-option-selection.service';

/** What the resolver needs from a line: which product it sells and which answers were chosen. */
type OptionLine = {
	variant_id: number;
	product_id: number;
	options?: readonly number[] | null;
};

/**
 * Turns the option ids a back-office line names into the snapshots the order stores - the order
 * feature's counterpart to what `CartPricingService` does for a basket.
 *
 * The choice is checked first by `ProductOptionSelectionService` - every answer one of the
 * product's, every question answered within its bounds - and refused with a 400 naming the variant.
 *
 * **The snapshot describes, the price does not move.** The delta is recorded as the catalog states
 * it in the document's currency today - a missing price row is a zero delta, as at checkout - and
 * the line's `price` stays the unit figure the operator agreed, deltas included.
 *
 * Labels come from the catalog through `ProductOptionSelectionService.loadLabels`, in the
 * deployment's default content language: a document reads the same whichever operator's dashboard
 * language it was saved from. They are `term` rows, but the term feature is the catalog's business -
 * an order resolves an option through the product that offers it and nothing else.
 */
export class OrderOptionService {
	constructor(private selection: ProductOptionSelectionService) {}

	public async resolveForLines(
		lines: readonly OptionLine[],
		currency: string,
	): Promise<(ProductOptionSnapshot[] | null)[]> {
		const optionIds = [
			...new Set(lines.flatMap((line) => line.options ?? [])),
		];

		const [groupsByProduct, prices, labelByOption] = await Promise.all([
			this.selection.loadGroups(lines.map((line) => line.product_id)),
			optionIds.length === 0
				? []
				: dataSource.getRepository(ProductOptionPriceEntity).find({
						where: { option_id: In(optionIds), currency: currency },
					}),
			this.selection.loadLabels(optionIds),
		]);

		const deltaByOption = new Map(
			prices.map((price) => [price.option_id, Number(price.price_delta)]),
		);

		return lines.map((line) => {
			const chosen = [...new Set(line.options ?? [])];
			const groups = groupsByProduct.get(line.product_id) ?? [];

			const problem = ProductOptionSelectionService.findProblem(
				groups,
				chosen,
			);

			if (problem?.reason === 'foreign_option') {
				throw new BadRequestError(
					lang('order.error.invalid_option', {
						variant_id: String(line.variant_id),
					}),
				);
			}

			if (problem?.reason === 'selection') {
				throw new BadRequestError(
					lang('order.error.option_selection', {
						variant_id: String(line.variant_id),
						min: String(problem.min),
						max: problem.max === null ? 'any' : String(problem.max),
					}),
				);
			}

			// In the catalog's own order - group, then answer - whatever order the ids came in
			const snapshots: ProductOptionSnapshot[] = groups.flatMap((group) =>
				group.options
					.filter((option) => chosen.includes(option.id))
					.map((option) => ({
						option_id: option.id,
						label:
							labelByOption.get(option.id) ??
							String(option.label_id),
						price_delta: deltaByOption.get(option.id) ?? 0,
						currency: currency,
					})),
			);

			return snapshots.length > 0 ? snapshots : null;
		});
	}
}

export const orderOptionService = new OrderOptionService(
	productOptionSelectionService,
);
