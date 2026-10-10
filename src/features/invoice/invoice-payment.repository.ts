import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import InvoicePaymentEntity from '@/features/invoice/invoice-payment.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class InvoicePaymentQuery extends RepositoryAbstract<InvoicePaymentEntity> {
	constructor(repository: Repository<InvoicePaymentEntity>) {
		super(repository, InvoicePaymentEntity.NAME);
	}
}

export const getInvoicePaymentRepository = () =>
	dataSource.getRepository(InvoicePaymentEntity).extend({
		createQuery() {
			return new InvoicePaymentQuery(this);
		},
	});
