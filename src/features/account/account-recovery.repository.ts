import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import AccountRecoveryEntity from '@/features/account/account-recovery.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class AccountRecoveryQuery extends RepositoryAbstract<AccountRecoveryEntity> {
	constructor(repository: Repository<AccountRecoveryEntity>) {
		super(repository, AccountRecoveryEntity.NAME);
	}

	filterByIdent(ident: string): this {
		this.hasFilter = true;

		return this.filterBy('ident', ident);
	}
}

export const getAccountRecoveryRepository = () =>
	dataSource.getRepository(AccountRecoveryEntity).extend({
		createQuery() {
			return new AccountRecoveryQuery(this);
		},

		// removeRecoveryById(id: EntityId): void {
		//     void this.createQuery()
		//         .filterById(id)
		//         .delete(false);
		// }
	});
