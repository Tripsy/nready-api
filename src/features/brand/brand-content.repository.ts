import type { EntityManager, Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import BrandContentEntity, {
	type BrandContentType,
} from '@/features/brand/brand-content.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class BrandContentQuery extends RepositoryAbstract<BrandContentEntity> {
	constructor(repository: Repository<BrandContentEntity>) {
		super(repository, BrandContentEntity.NAME);
	}
}

export const BrandContentRepository = dataSource
	.getRepository(BrandContentEntity)
	.extend({
		createQuery() {
			return new BrandContentQuery(this);
		},

		async saveContent(
			manager: EntityManager,
			contents: BrandContentType[],
			brand_id: EntityId,
		) {
			if (!contents.length) {
				return;
			}

			await manager
				.createQueryBuilder()
				.insert()
				.into(BrandContentEntity)
				.values(
					contents.map((c) => ({
						brand_id: brand_id,
						language: c.language,
						description: c.description,
						meta: c.meta,
					})),
				)
				.orUpdate(['description', 'meta'], ['brand_id', 'language'])
				.execute();
		},
	});

export default BrandContentRepository;
