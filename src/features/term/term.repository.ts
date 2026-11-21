import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import TermEntity from '@/features/term/term.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class TermQuery extends RepositoryAbstract<TermEntity> {
	constructor(repository: Repository<TermEntity>) {
		super(repository, TermEntity.NAME);
	}

	/**
	 * Matches the id when numeric, otherwise the wording in any language.
	 *
	 * The text lives in `term_content`, so this filters through EXISTS rather than the join the
	 * select uses: a term with the same match in two languages would otherwise come back twice,
	 * and joining on the search would drop the other languages from the selected contents.
	 */
	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				this.filterRaw(
					`EXISTS (
						SELECT 1 FROM "term_content" "search_content"
						WHERE "search_content"."term_id" = "term"."id"
							AND "search_content"."value" ILIKE :searchTermValue
					)`,
					{ searchTermValue: `%${term}%` },
				);
			}
		}

		return this;
	}
}

export const getTermRepository = () =>
	dataSource.getRepository(TermEntity).extend({
		createQuery() {
			return new TermQuery(this);
		},
	});
