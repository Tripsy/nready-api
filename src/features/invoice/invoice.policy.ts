import InvoiceEntity from '@/features/invoice/invoice.entity';
import PolicyAbstract from '@/shared/abstracts/policy.abstract';

/**
 * Plain CRUD authorization over the `invoice` entity - the lines and the allocations are part of
 * the document, so they are gated by `update` on it rather than by permissions of their own.
 */
export class InvoicePolicy extends PolicyAbstract {
	constructor() {
		super(InvoiceEntity.NAME);
	}
}

export const invoicePolicy = new InvoicePolicy();
