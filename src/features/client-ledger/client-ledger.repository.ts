import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ClientLedgerEntity from '@/features/client-ledger/client-ledger.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class ClientLedgerQuery extends RepositoryAbstract<ClientLedgerEntity> {
	constructor(repository: Repository<ClientLedgerEntity>) {
		super(repository, ClientLedgerEntity.NAME);
	}
}

export const getClientLedgerRepository = () =>
	dataSource.getRepository(ClientLedgerEntity).extend({
		createQuery() {
			return new ClientLedgerQuery(this);
		},
	});
