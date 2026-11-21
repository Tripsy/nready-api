import type { DeepPartial } from 'typeorm';
import VendorEntity, {
	STATUS_TRANSITIONS,
	type VendorStatus,
} from '@/features/vendor/vendor.entity';
import { getVendorRepository } from '@/features/vendor/vendor.repository';
import {
	paramsUpdateList,
	type VendorValidator,
} from '@/features/vendor/vendor.validator';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import {
	assertValidStatusTransition,
	cleanEntityCache,
} from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

export class VendorService {
	constructor(private repository: ReturnType<typeof getVendorRepository>) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<VendorValidator, 'create'>,
	): Promise<VendorEntity> {
		const entry = {
			name: data.name,
			type: data.type,
		};

		return this.repository.save(entry);
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<VendorEntity> & { id: EntityId },
	): Promise<VendorEntity> {
		const saved = await this.repository.save(data);

		await cleanEntityCache(VendorEntity, saved.id);

		return saved;
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: VendorEntity,
		data: ValidatorOutput<VendorValidator, 'update'>,
	) {
		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	public async updateStatus(
		entry: VendorEntity,
		newStatus: VendorStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		await this.update(entry);
	}

	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: EntityId) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(id: EntityId, withDeleted: boolean): Promise<VendorEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: { id: EntityId; withDeleted: boolean }) {
		return await this.repository
			.createQuery()
			.select([
				'vendor.id',
				'vendor.name',
				'vendor.type',
				'vendor.status',
				'vendor.created_at',
				'vendor.updated_at',
				'vendor.deleted_at',
			])
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();
	}

	public findByFilter(
		data: ValidatorOutput<VendorValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.select([
				'vendor.id',
				'vendor.name',
				'vendor.type',
				'vendor.status',
				'vendor.created_at',
				'vendor.updated_at',
				'vendor.deleted_at',
			])
			.filterById(data.filter.id)
			.filterBy('type', data.filter.type)
			.filterBy('status', data.filter.status)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const vendorService = new VendorService(getVendorRepository());
