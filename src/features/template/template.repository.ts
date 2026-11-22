import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import TemplateEntity from '@/features/template/template.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class TemplateQuery extends RepositoryAbstract<TemplateEntity> {
	constructor(repository: Repository<TemplateEntity>) {
		super(repository, TemplateEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterAny([
					{
						column: 'label',
						value: term,
						operator: 'ILIKE',
					},
					{
						column: 'content::text',
						value: term,
						operator: 'ILIKE',
					},
				]);
			}
		}

		return this;
	}
}

export const getTemplateRepository = () =>
	dataSource.getRepository(TemplateEntity).extend({
		createQuery() {
			return new TemplateQuery(this);
		},
	});
