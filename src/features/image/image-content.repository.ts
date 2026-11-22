import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import ImageContentEntity, {
	type ImageContentType,
} from '@/features/image/image-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class ImageContentQuery extends RepositoryAbstract<ImageContentEntity> {
	constructor(repository: Repository<ImageContentEntity>) {
		super(repository, ImageContentEntity.NAME);
	}
}

export const ImageContentRepository = dataSource
	.getRepository(ImageContentEntity)
	.extend({
		createQuery() {
			return new ImageContentQuery(this);
		},

		async saveContent(
			manager: EntityManager,
			contents: ImageContentType[],
			image_id: EntityId,
		) {
			if (!contents.length) {
				return;
			}

			await manager
				.createQueryBuilder()
				.insert()
				.into(ImageContentEntity)
				.values(
					contents.map((c) => ({
						image_id: image_id,
						language: c.language,
						title: c.title,
						description: c.description,
					})),
				)
				.orUpdate(['title', 'description'], ['image_id', 'language'])
				.execute();
		},
	});

export default ImageContentRepository;
