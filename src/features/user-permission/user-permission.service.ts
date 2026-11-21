import { lang } from '@/config/message.setup';
import UserEntity from '@/features/user/user.entity';
import { getUserPermissionRepository } from '@/features/user-permission/user-permission.repository';
import type { UserPermissionValidator } from '@/features/user-permission/user-permission.validator';
import { cleanEntityCache } from '@/shared/abstracts/service.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * The only cross-entity invalidation in the codebase: a permission row is never read on its own,
 * but the caller's permission set is baked into the cached `user` entry the auth middleware reads.
 * So every write here drops **`user:<user_id>*`**, not this table's own keys - which nothing reads.
 *
 * It is also the only invalidation that has to fire on *insert*: granting a permission changes an
 * entry that already exists and is already cached.
 */
export class UserPermissionService {
	constructor(
		private repository: ReturnType<typeof getUserPermissionRepository>,
	) {}

	/**
	 * @description Used in `create` method from controller;
	 */
	public async create(
		data: ValidatorOutput<UserPermissionValidator, 'create'>,
	) {
		const results = await Promise.all(
			data.permission_ids.map(async (permission_id) => {
				const existingUserPermission = await this.repository
					.createQuery()
					.select(['id', 'deleted_at'])
					.filterBy('user_id', data.user_id)
					.filterBy('permission_id', permission_id)
					.withDeleted()
					.first();

				if (existingUserPermission) {
					if (existingUserPermission.deleted_at) {
						await this.repository.restore(
							existingUserPermission.id,
						);

						return {
							permission_id,
							message: lang('user-permission.success.restore'),
						};
					}

					return {
						permission_id,
						message: lang('user-permission.error.already_exists'),
					};
				}

				await this.repository.save({
					user_id: data.user_id,
					permission_id,
				});

				return {
					permission_id,
					message: lang('user-permission.success.create'),
				};
			}),
		);

		// Once for the whole grant rather than per permission - they all belong to one user,
		// and one scan of the keyspace answers for the lot.
		await cleanEntityCache(UserEntity, data.user_id);

		return results;
	}

	public async delete(user_id: EntityId, permission_id: EntityId) {
		await this.repository
			.createQuery()
			.filterBy('user_id', user_id)
			.filterBy('permission_id', permission_id)
			.delete(true, false, true);

		await cleanEntityCache(UserEntity, user_id);
	}

	/**
	 * Addressed by the pair rather than by the grant row's own id, matching `delete`.
	 *
	 * `restore()` reads with `withDeleted()`, so a pair that is currently granted matches its
	 * live row and is restored to the state it is already in - the call is idempotent and only
	 * a pair with no row at all answers 404.
	 */
	public async restore(user_id: EntityId, permission_id: EntityId) {
		await this.repository
			.createQuery()
			.filterBy('user_id', user_id)
			.filterBy('permission_id', permission_id)
			.restore();

		await cleanEntityCache(UserEntity, user_id);
	}

	public findByFilter(
		data: ValidatorOutput<UserPermissionValidator, 'find'>,
		withDeleted: boolean,
		user_id: EntityId,
	) {
		return this.repository
			.createQuery()
			.join('user_permission.user', 'user')
			.join('user_permission.permission', 'permission')
			.filterBy('user_id', user_id)
			.filterBy('permission.entity', data.filter.entity, 'LIKE')
			.filterBy('permission.operation', data.filter.operation, 'LIKE')
			.withDeleted(withDeleted && data.filter.is_deleted)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}
}

export const userPermissionService = new UserPermissionService(
	getUserPermissionRepository(),
);
