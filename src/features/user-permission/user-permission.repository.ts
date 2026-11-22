import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import UserPermissionEntity from '@/features/user-permission/user-permission.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class UserPermissionQuery extends RepositoryAbstract<UserPermissionEntity> {
	constructor(repository: Repository<UserPermissionEntity>) {
		super(repository, UserPermissionEntity.NAME);
	}
}

export const getUserPermissionRepository = () =>
	dataSource.getRepository(UserPermissionEntity).extend({
		createQuery() {
			return new UserPermissionQuery(this);
		},

		getUserPermissions(user_id: EntityId) {
			const q = this.createQuery()
				.join('user_permission.permission', 'permission')
				.filterBy('user_permission.user_id', user_id)
				.select(['permission.entity', 'permission.operation'])
				.getQuery();

			return q.getRawMany();
		},
	});
