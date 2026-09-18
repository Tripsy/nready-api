import type { DeepPartial } from 'typeorm';
import DiscountEntity, {
	DiscountScopeEnum,
} from '@/features/discount/discount.entity';
import { getDiscountRepository } from '@/features/discount/discount.repository';
import {
	type DiscountValidator,
	paramsUpdateList,
} from '@/features/discount/discount.validator';
import { discountTargetService } from '@/features/discount/discount-target.service';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class DiscountService {
	constructor(private repository: ReturnType<typeof getDiscountRepository>) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<DiscountValidator, 'create'>,
	): Promise<DiscountEntity> {
		const entry = {
			label: data.label,
			scope: data.scope,
			reason: data.reason,
			reference: data.reference ?? null,
			type: data.type,
			conditions: data.conditions,
			value: data.value,
			start_at: data.start_at ?? null,
			end_at: data.end_at ?? null,
			notes: data.notes ?? null,
		};

		return this.repository.save(entry);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<DiscountEntity> & { id: number },
	): Promise<DiscountEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(DiscountEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: DiscountEntity,
		data: ValidatorOutput<DiscountValidator, 'update'>,
	) {
		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		// A discount moved onto `shipping` has to leave behind the target types that scope cannot use
		if (data.scope === DiscountScopeEnum.SHIPPING) {
			discountTargetService.assertTargetsFitScope(
				entry.scope,
				await discountTargetService.listTargets(entry.id),
			);
		}

		return this.update(entry);
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: number, withDeleted: boolean): Promise<DiscountEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	public findByFilter(
		data: ValidatorOutput<DiscountValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.filterById(data.filter.id)
			.filterBy('scope', data.filter.scope)
			.filterBy('reason', data.filter.reason)
			.filterBy('type', data.filter.type)
			.filterByRange(
				'start_at',
				data.filter.start_at_start,
				data.filter.start_at_end,
			)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const discountService = new DiscountService(getDiscountRepository());
