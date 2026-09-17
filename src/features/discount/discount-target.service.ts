import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { BadRequestError } from '@/exceptions';
import {
	type DiscountScope,
	DiscountScopeEnum,
} from '@/features/discount/discount.entity';
import DiscountTargetEntity, {
	type DiscountTargetType,
	DiscountTargetTypeEnum,
} from '@/features/discount/discount-target.entity';

/** `{ client: [3, 9], category: [12] }` - the shape the reconcile endpoint speaks. */
export type DiscountTargetMap = Partial<Record<DiscountTargetType, number[]>>;

export const discountTargetTypes = Object.values(
	DiscountTargetTypeEnum,
) as DiscountTargetType[];

export class DiscountTargetService {
	constructor(
		private repository: Repository<DiscountTargetEntity> = dataSource.getRepository(
			DiscountTargetEntity,
		),
	) {}

	/**
	 * Refuses a target set the discount's scope cannot use.
	 *
	 * Only `shipping` is constrained: it narrows itself to clients and has nothing else it could
	 * apply to, and the line pass matches targets without reading the scope - so a product target on
	 * a shipping discount would be a rule that silently never fires. Every other scope keeps
	 * accepting any type, as it always has.
	 */
	public assertTargetsFitScope(
		scope: DiscountScope,
		targets: DiscountTargetMap,
	): void {
		if (scope !== DiscountScopeEnum.SHIPPING) {
			return;
		}

		const misfit = discountTargetTypes.some(
			(targetType) =>
				targetType !== DiscountTargetTypeEnum.CLIENT &&
				(targets[targetType]?.length ?? 0) > 0,
		);

		if (misfit) {
			throw new BadRequestError(lang('discount.error.shipping_targets'));
		}
	}

	/** Entity ids currently linked to a discount, grouped by target type. */
	public async listTargets(discountId: number): Promise<DiscountTargetMap> {
		const rows = await this.repository.find({
			where: { discount_id: discountId },
			select: { target_type: true, entity_id: true },
		});

		const result: DiscountTargetMap = {};

		for (const row of rows) {
			const group = result[row.target_type] ?? [];

			group.push(row.entity_id);
			result[row.target_type] = group;
		}

		return result;
	}

	/**
	 * Makes the stored links match `targets` exactly, in one transaction.
	 *
	 * Only the types present in `targets` are touched - passing `{ category: [] }` clears the
	 * category links and leaves every other type alone, so a caller editing one scope cannot
	 * wipe the others by omission.
	 *
	 * Rows are hard-deleted rather than soft-deleted. The partial unique index ignores
	 * soft-deleted rows, so a link removed and re-added would otherwise accumulate tombstones
	 * that no query ever reads, and the link carries no history worth keeping - what was
	 * actually charged lives in the order line's snapshot.
	 */
	public async replaceTargets(
		discountId: number,
		targets: DiscountTargetMap,
	): Promise<DiscountTargetMap> {
		await this.repository.manager.transaction(async (manager) => {
			const repository = manager.getRepository(DiscountTargetEntity);

			for (const targetType of discountTargetTypes) {
				const requested = targets[targetType];

				if (requested === undefined) {
					continue;
				}

				await repository.delete({
					discount_id: discountId,
					target_type: targetType,
				});

				const wanted = [...new Set(requested)];

				if (wanted.length === 0) {
					continue;
				}

				await repository.insert(
					wanted.map((entityId) => ({
						discount_id: discountId,
						target_type: targetType,
						entity_id: entityId,
					})),
				);
			}
		});

		return this.listTargets(discountId);
	}
}

export const discountTargetService = new DiscountTargetService();
