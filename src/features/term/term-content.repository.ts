import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import TermContentEntity, {
	type TermContentType,
} from '@/features/term/term-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class TermContentQuery extends RepositoryAbstract<TermContentEntity> {
	constructor(repository: Repository<TermContentEntity>) {
		super(repository, TermContentEntity.NAME);
	}
}

export const TermContentRepository = dataSource
	.getRepository(TermContentEntity)
	.extend({
		createQuery() {
			return new TermContentQuery(this);
		},

		async saveContent(
			manager: EntityManager,
			contents: TermContentType[],
			term_id: EntityId,
		) {
			if (!contents.length) {
				return;
			}

			await manager
				.createQueryBuilder()
				.insert()
				.into(TermContentEntity)
				.values(
					contents.map((content) => ({
						term_id: term_id,
						language: content.language,
						value: content.value,
					})),
				)
				.orUpdate(['value'], ['term_id', 'language'])
				.execute();
		},
	});

export default TermContentRepository;
