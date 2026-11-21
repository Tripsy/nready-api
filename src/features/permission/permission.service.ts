import { lang } from '@/config/message.setup';
import { CustomError } from '@/exceptions';
import PermissionEntity from '@/features/permission/permission.entity';
import { getPermissionRepository } from '@/features/permission/permission.repository';
import type { PermissionValidator } from '@/features/permission/permission.validator';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

type PermissionCreateResult = {
	permission: PermissionEntity;
	action: 'create' | 'restore';
};

export class PermissionService {
	constructor(
		private repository: ReturnType<typeof getPermissionRepository>,
	) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<PermissionValidator, 'create'>,
		withDeleted: boolean,
	): Promise<PermissionCreateResult> {
		const existingPermission = await this.checkIfExist(
			data.entity,
			data.operation,
			['id', 'entity', 'operation', 'deleted_at'],
		);

		if (existingPermission) {
			if (existingPermission.deleted_at) {
				if (withDeleted) {
					await this.restore(existingPermission.id);

					return {
						permission: {
							...existingPermission,
							deleted_at: null,
						},
						action: 'restore',
					};
				} else {
					throw new CustomError(
						409,
						lang('permission.error.already_exists_as_deleted'),
					);
				}
			} else {
				throw new CustomError(
					409,
					lang('permission.error.already_exists'),
				);
			}
		} else {
			const entry = await this.repository.save({
				entity: data.entity,
				operation: data.operation,
			});

			return {
				permission: entry,
				action: 'create',
			};
		}
	}

	/**
	 * @description Used in `update` method from controller
	 */
	public async updateData(
		entry: PermissionEntity,
		data: ValidatorOutput<PermissionValidator, 'update'>,
	) {
		const existingPermission = await this.checkIfExist(
			data.entity,
			data.operation,
			['id', 'deleted_at'],
			entry.id,
		);

		if (existingPermission) {
			if (existingPermission.deleted_at) {
				throw new CustomError(
					409,
					lang('permission.error.already_exists_as_deleted'),
				);
			}

			throw new CustomError(409, lang('permission.error.already_exists'));
		}

		const saved = await this.repository.save({
			id: entry.id,
			entity: data.entity,
			operation: data.operation,
		});

		// This feature has no `update()` wrapper for the clean to live in.
		await cleanEntityCache(PermissionEntity, saved.id);

		return saved;
	}

	public async delete(id: EntityId) {
		await this.repository.createQuery().filterById(id).delete();
	}

	public async restore(id: EntityId) {
		await this.repository.createQuery().filterById(id).restore();
	}

	public findById(
		id: EntityId,
		withDeleted: boolean,
	): Promise<PermissionEntity> {
		return this.repository
			.createQuery()
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	public checkIfExist(
		entity: string,
		operation: string,
		fields?: string[],
		withoutId?: EntityId,
	) {
		const q = this.repository
			.createQuery()
			.select(['id', 'entity', 'operation', 'deleted_at'])
			.filterBy('entity', entity)
			.filterBy('operation', operation)
			.withDeleted(true);

		if (withoutId) {
			q.filterBy('id', withoutId, '!=');
		}

		if (fields) {
			q.select(fields);
		}

		return q.first();
	}

	public findByFilter(
		data: ValidatorOutput<PermissionValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.filterById(data.filter.id)
			.filterByTerm(data.filter.term)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const permissionService = new PermissionService(
	getPermissionRepository(),
);
