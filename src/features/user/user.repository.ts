import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import UserEntity from '@/features/user/user.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class UserQuery extends RepositoryAbstract<UserEntity> {
	constructor(repository: Repository<UserEntity>) {
		super(repository, UserEntity.NAME);
	}

	filterByEmail(email?: string): this {
		if (email) {
			this.hasFilter = true;
			this.filterBy('email', email);
		}

		return this;
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'name',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'email',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getUserRepository = () => {
	const repo = dataSource.getRepository(UserEntity);

	return repo.extend({
		createQuery() {
			return new UserQuery(this);
		},

		// async doSave(data: Partial<UserEntity>) {
		// 	const { id, ...saveData } = data;
		//
		// 	let entity: UserEntity;
		//
		// 	if (id) {
		// 		// Update existing entity
		// 		entity = await repo.findOneByOrFail({ id });
		// 		Object.assign(entity, saveData);
		// 	} else {
		// 		// Create new entity
		// 		entity = repo.create(saveData);
		// 	}
		//
		// 	return this.forceSave(entity);
		// },
		//
		// async forceSave(entity: UserEntity) {
		// 	return repo.save(entity);
		// },

		// save() {
		// 	throw new Error(
		// 		'Direct save() is not allowed. Use updateById() or safeSave().',
		// 	);
		// },
	});
};
