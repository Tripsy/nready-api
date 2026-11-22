import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import GrnEntity from '@/features/grn/grn.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

/**
 * A written document reference - series code plus number, `NIR-42` / `nir 42`. The same shape
 * `order.repository.ts` reads; restated here because `grn` does not depend on `order`.
 */
const REFERENCE_PATTERN = /^([a-z]{2,10})[\s\-/]?(\d{1,10})$/i;

export class GrnQuery extends RepositoryAbstract<GrnEntity> {
	constructor(repository: Repository<GrnEntity>) {
		super(repository, GrnEntity.NAME);
	}

	/**
	 * The list's one search box.
	 *
	 * - A bare number is read as the receipt's own number in its series - what an operator types
	 *   off a printed NIR.
	 * - A written reference (`NIR-42`) matches through `IDX_grn_ref`.
	 * - Anything else searches the supplier's document number, the string printed on the delivery
	 *   note the goods arrived with.
	 */
	filterByTerm(term?: string): this {
		const value = term?.trim();

		if (!value) {
			return this;
		}

		if (!Number.isNaN(Number(value))) {
			return this.filterBy('ref_number', Number(value));
		}

		if (value.length < Configuration.get('filter.termMinLength')) {
			return this;
		}

		const reference = REFERENCE_PATTERN.exec(value);

		if (reference) {
			return this.filterRaw(
				'((grn.ref_code = :term_ref_code AND grn.ref_number = :term_ref_number) OR grn.supplier_document_number ILIKE :term_document)',
				{
					term_ref_code: reference[1].toUpperCase(),
					term_ref_number: Number(reference[2]),
					term_document: `%${value}%`,
				},
			);
		}

		return this.filterBy('supplier_document_number', value, 'ILIKE');
	}
}

export const getGrnRepository = () =>
	dataSource.getRepository(GrnEntity).extend({
		createQuery() {
			return new GrnQuery(this);
		},
	});
