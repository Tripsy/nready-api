import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import AccountTokenEntity from '@/features/account/account-token.entity';
import { runInBackground } from '@/helpers/background.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class AccountTokenQuery extends RepositoryAbstract<AccountTokenEntity> {
	constructor(repository: Repository<AccountTokenEntity>) {
		super(repository, AccountTokenEntity.NAME);
	}

	filterByIdent(ident: string): this {
		this.hasFilter = true;

		return this.filterBy('ident', ident);
	}
}

export const getAccountTokenRepository = () =>
	dataSource.getRepository(AccountTokenEntity).extend({
		createQuery() {
			return new AccountTokenQuery(this);
		},

		/*
		 * Fire-and-forget by design: the only callers are in `auth.middleware.ts`, which
		 * continues to `next()` regardless - cleaning up a dead token must not add latency
		 * to the request. `runInBackground` keeps a failed delete from surfacing as an
		 * unhandled rejection, which `server.ts` would treat as grounds for a shutdown.
		 */
		removeTokenById(id: EntityId): void {
			runInBackground(
				this.createQuery().filterById(id).delete(false),
				`Failed to remove account token #${id}`,
			);
		},
	});
