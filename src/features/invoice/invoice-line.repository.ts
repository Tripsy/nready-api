import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import InvoiceLineEntity from '@/features/invoice/invoice-line.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class InvoiceLineQuery extends RepositoryAbstract<InvoiceLineEntity> {
	constructor(repository: Repository<InvoiceLineEntity>) {
		super(repository, InvoiceLineEntity.NAME);
	}
}

export const getInvoiceLineRepository = () =>
	dataSource.getRepository(InvoiceLineEntity).extend({
		createQuery() {
			return new InvoiceLineQuery(this);
		},
	});
