import {
	type DeepPartial,
	type EntityManager,
	Not,
	QueryFailedError,
} from 'typeorm';
import dataSource from '@/config/data-source.config';
import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import {
	type AddressService,
	addressService,
} from '@/features/address/address.service';
import WarehouseEntity, {
	STATUS_TRANSITIONS,
	type WarehouseStatus,
} from '@/features/warehouse/warehouse.entity';
import { getWarehouseRepository } from '@/features/warehouse/warehouse.repository';
import {
	paramsUpdateList,
	type WarehouseValidator,
} from '@/features/warehouse/warehouse.validator';
import { pickValuesFromObject } from '@/helpers/objects.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	assertValidStatusTransition,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import type { ValidatorOutput } from '@/shared/types/mock.type';

const ENTRY_COLUMNS = [
	'warehouse.id',
	'warehouse.address_id',
	'warehouse.code',
	'warehouse.name',
	'warehouse.status',
	'warehouse.is_default',
	'warehouse.notes',
	'warehouse.created_at',
	'warehouse.updated_at',
	'warehouse.deleted_at',
];

const ADDRESS_COLUMNS = [
	'address.id',
	'address.city_id',
	'address.details',
	'address.postal_code',
];

export class WarehouseService {
	constructor(
		private repository: ReturnType<typeof getWarehouseRepository>,
		private addressService: AddressService,
	) {}

	/**
	 * The address is `ON DELETE RESTRICT`, so a bad id would surface as a masked 500 from the
	 * foreign key. Resolving it first turns that into the address feature's own 404.
	 *
	 * `withDeleted` is false: a warehouse must not be filed against an address somebody removed.
	 */
	private async checkAddressId(address_id: number): Promise<void> {
		await this.addressService.findById(address_id, false);
	}

	/**
	 * Demotes whatever holds the default right now, so the promotion that follows cannot collide
	 * with `IDX_warehouse_default`. Runs inside the caller's transaction and returns the ids it
	 * touched, which the caller owes a cache clean for - a demoted row's cached copy still claims
	 * to be the default.
	 *
	 * `excludeId` keeps a row being updated from demoting itself.
	 */
	private async clearDefault(
		manager: EntityManager,
		excludeId?: number,
	): Promise<number[]> {
		const repository = manager.getRepository(WarehouseEntity);

		const currentDefaults = await repository.find({
			select: { id: true },
			where: {
				is_default: true,
				...(excludeId ? { id: Not(excludeId) } : {}),
			},
		});

		if (currentDefaults.length === 0) {
			return [];
		}

		const ids = currentDefaults.map((entry) => entry.id);

		await repository.update(ids, { is_default: false });

		return ids;
	}

	/**
	 * `code` is unique among the rows that are not deleted, and it is the one column a person
	 * types by hand - so the collision is expected traffic, not an exceptional case. Anything
	 * that is not a unique violation is returned untouched so it keeps its stack.
	 */
	private asConflict(error: unknown): unknown {
		if (!RepositoryAbstract.isUniqueViolation(error)) {
			return error;
		}

		const constraint =
			error instanceof QueryFailedError
				? (error.driverError?.constraint as string | undefined)
				: undefined;

		if (constraint === 'IDX_warehouse_default') {
			return new CustomError(
				409,
				lang('warehouse.error.default_conflict'),
			);
		}

		return new CustomError(409, lang('warehouse.error.code_taken'));
	}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<WarehouseValidator, 'create'>,
	): Promise<WarehouseEntity> {
		await this.checkAddressId(data.address_id);

		try {
			const { saved, demotedIds } = await dataSource.transaction(
				async (manager) => {
					const repository = manager.getRepository(WarehouseEntity);

					// Demote before inserting: both rows would otherwise be default at once,
					// which the partial unique index refuses
					const demoted = data.is_default
						? await this.clearDefault(manager)
						: [];

					const entry = await repository.save({
						address_id: data.address_id,
						code: data.code,
						name: data.name,
						is_default: data.is_default,
						notes: data.notes ?? null,
					});

					return { saved: entry, demotedIds: demoted };
				},
			);

			await cleanEntityCacheMany(WarehouseEntity, demotedIds);

			return saved;
		} catch (error) {
			throw this.asConflict(error);
		}
	}

	/**
	 * @description Update any data
	 */
	public async update(
		data: DeepPartial<WarehouseEntity> & { id: number },
	): Promise<WarehouseEntity> {
		try {
			const { saved, touchedIds } = await dataSource.transaction(
				async (manager) => {
					const repository = manager.getRepository(WarehouseEntity);

					const demoted = data.is_default
						? await this.clearDefault(manager, data.id)
						: [];

					const entry = await repository.save(data);

					return {
						saved: entry,
						touchedIds: [...demoted, entry.id],
					};
				},
			);

			await cleanEntityCacheMany(WarehouseEntity, touchedIds);

			return saved;
		} catch (error) {
			throw this.asConflict(error);
		}
	}

	/**
	 * @description Used in `update` method from controller; `data` is filtered by `paramsUpdateList` - which is declared in validator
	 */
	public async updateData(
		entry: WarehouseEntity,
		data: ValidatorOutput<WarehouseValidator, 'update'>,
	) {
		if (data.address_id) {
			await this.checkAddressId(data.address_id);
		}

		Object.assign(entry, pickValuesFromObject(data, paramsUpdateList));

		return this.update(entry);
	}

	public async updateStatus(
		entry: WarehouseEntity,
		newStatus: WarehouseStatus,
	): Promise<void> {
		assertValidStatusTransition(
			STATUS_TRANSITIONS,
			entry.status,
			newStatus,
		);

		entry.status = newStatus;

		await this.update(entry);
	}

	public async delete(id: number) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: number) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(
		id: number,
		withDeleted: boolean,
	): Promise<WarehouseEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `read` method from controller; this will return a custom shape
	 */
	public async getEntryData(data: { id: number; withDeleted: boolean }) {
		return await this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...ADDRESS_COLUMNS])
			.joinAndSelect('warehouse.address', 'address', 'LEFT')
			.filterById(data.id)
			.withDeleted(data.withDeleted)
			.firstOrFail();
	}

	public findByFilter(
		data: ValidatorOutput<WarehouseValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.select([...ENTRY_COLUMNS, ...ADDRESS_COLUMNS])
			.joinAndSelect('warehouse.address', 'address', 'LEFT')
			.filterById(data.filter.id)
			.filterBy('address_id', data.filter.address_id)
			.filterBy('status', data.filter.status)
			.filterBy('is_default', data.filter.is_default)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const warehouseService = new WarehouseService(
	getWarehouseRepository(),
	addressService,
);
