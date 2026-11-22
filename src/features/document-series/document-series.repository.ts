import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import DocumentSeriesEntity from '@/features/document-series/document-series.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class DocumentSeriesQuery extends RepositoryAbstract<DocumentSeriesEntity> {
	constructor(repository: Repository<DocumentSeriesEntity>) {
		super(repository, DocumentSeriesEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'code',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getDocumentSeriesRepository = () =>
	dataSource.getRepository(DocumentSeriesEntity).extend({
		createQuery() {
			return new DocumentSeriesQuery(this);
		},
	});

/**
 * Allocation runs inside the caller's transaction - the whole point is that a rolled-back
 * document rolls the counter back with it - so it cannot go through the module-level
 * repository, which is bound to the data source rather than to that transaction's manager.
 */
export const createDocumentSeriesQuery = (manager: EntityManager) =>
	new DocumentSeriesQuery(manager.getRepository(DocumentSeriesEntity));
