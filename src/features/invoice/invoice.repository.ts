import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import InvoiceEntity, {
	InvoicePaymentStatusEnum,
} from '@/features/invoice/invoice.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class InvoiceQuery extends RepositoryAbstract<InvoiceEntity> {
	constructor(repository: Repository<InvoiceEntity>) {
		super(repository, InvoiceEntity.NAME);
	}

	/**
	 * A number a person read off a document, or free text from the notes.
	 *
	 * A bare number is the `ref_number` printed next to the series - what an operator types when a
	 * buyer calls about an invoice.
	 */
	filterByTerm(term?: string): this {
		if (!term) {
			return this;
		}

		const trimmed = term.trim();

		if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
			return this.filterBy('ref_number', Number(trimmed));
		}

		if (trimmed.length >= Configuration.get('filter.termMinLength')) {
			this.filterAny([
				{
					column: 'ref_code',
					value: trimmed,
					operator: 'ILIKE',
				},
				{
					column: 'notes',
					value: trimmed,
					operator: 'ILIKE',
				},
			]);
		}

		return this;
	}

	/**
	 * Late right now, which is not what `overdue_at` alone says - that column is never cleared,
	 * so it also matches an invoice that was late once and has since been settled. Both halves
	 * are needed and the entity comment on `overdue_at` is the reference.
	 */
	filterByOverdue(overdue?: boolean): this {
		if (overdue === undefined) {
			return this;
		}

		if (overdue) {
			// `filterBy` drops a null value, so the IS NULL halves are raw on both arms
			this.filterRaw('invoice.overdue_at IS NOT NULL');
			this.filterBy(
				'payment_status',
				InvoicePaymentStatusEnum.PAID,
				'!=',
			);
		} else {
			this.filterRaw(
				'(invoice.overdue_at IS NULL OR invoice.payment_status = :paid_status)',
				{ paid_status: InvoicePaymentStatusEnum.PAID },
			);
		}

		return this;
	}
}

export const getInvoiceRepository = () =>
	dataSource.getRepository(InvoiceEntity).extend({
		createQuery() {
			return new InvoiceQuery(this);
		},
	});
