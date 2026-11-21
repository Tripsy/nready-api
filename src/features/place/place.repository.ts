import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import { Configuration } from '@/config/settings.config';
import PlaceEntity from '@/features/place/place.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';

export class PlaceQuery extends RepositoryAbstract<PlaceEntity> {
	constructor(repository: Repository<PlaceEntity>) {
		super(repository, PlaceEntity.NAME);
	}

	filterByTerm(term?: string): this {
		if (term) {
			if (term.length >= Configuration.get('filter.termMinLength')) {
				const tsTerm = this.prepareTsTerm(term);

				/*
				 * Skipped when the input carried no searchable text: `:*` on its own is
				 * a tsquery syntax error, which Postgres raises rather than treating as
				 * an empty match.
				 *
				 * The expression is repeated verbatim from
				 * `IDX_place_content_name_search`; a GIN expression index is only used
				 * when the query's expression matches it exactly, so editing one without
				 * the other silently drops back to a sequential scan.
				 */
				if (tsTerm !== '') {
					this.filterRaw(
						`to_tsvector('simple', COALESCE(content.name, '')) @@ to_tsquery('simple', :term || ':*')`,
						{ term: tsTerm },
					);
				}
			}
		}

		return this;
	}
}

export const getPlaceRepository = () =>
	dataSource.getRepository(PlaceEntity).extend({
		createQuery() {
			return new PlaceQuery(this);
		},
	});
