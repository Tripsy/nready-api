import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import PlaceContentEntity, {
	type PlaceContentType,
} from '@/features/place/place-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class PlaceContentQuery extends RepositoryAbstract<PlaceContentEntity> {
	constructor(repository: Repository<PlaceContentEntity>) {
		super(repository, PlaceContentEntity.NAME);
	}
}

export const PlaceContentRepository = dataSource
	.getRepository(PlaceContentEntity)
	.extend({
		createQuery() {
			return new PlaceContentQuery(this);
		},

		async saveContent(
			manager: EntityManager,
			contents: PlaceContentType[],
			place_id: EntityId,
		) {
			if (!contents.length) {
				return;
			}

			await manager
				.createQueryBuilder()
				.insert()
				.into(PlaceContentEntity)
				.values(
					contents.map((c) => ({
						place_id: place_id,
						language: c.language,
						name: c.name,
						type_label: c.type_label,
					})),
				)
				.orUpdate(['name', 'type_label'], ['place_id', 'language'])
				.execute();
		},
	});

export default PlaceContentRepository;
