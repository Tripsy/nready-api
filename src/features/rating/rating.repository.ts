import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import type {
	RatingEntityType,
	RatingType,
} from '@/features/rating/rating.entity';
import RatingEntity from '@/features/rating/rating.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class RatingQuery extends RepositoryAbstract<RatingEntity> {
	constructor(repository: Repository<RatingEntity>) {
		super(repository, RatingEntity.NAME);
	}

	/**
	 * The three columns every read of this table starts from, in the order `IDX_rating_entity`
	 * holds them. `type` is optional: a summary asks for every type a target carries, while a
	 * single vote addresses one.
	 */
	filterByTarget(
		entityType?: RatingEntityType | null,
		entityId?: EntityId | null,
		type?: RatingType | null,
	): this {
		this.filterBy('entity_type', entityType);
		this.filterBy('entity_id', entityId);
		this.filterBy('type', type);

		return this;
	}

	/**
	 * Narrows to the rows the caller is allowed to speak for, which is what makes a public delete
	 * safe without an ownership check downstream.
	 *
	 * A signed-in caller is matched by `user_id` alone - their rating may have been cast from a
	 * different address than the one they are deleting it from.
	 *
	 * A guest is matched by address **and** `user_id IS NULL`. Dropping that second condition would
	 * let anyone sharing an address - a household, an office, a carrier's NAT - delete a signed-in
	 * user's rating, since `UQ_rating_ip` allows both rows to exist under the same hash.
	 */
	filterByOwner(userId: EntityId | null, userIpHash: string): this {
		if (userId) {
			this.filterBy('user_id', userId);

			return this;
		}

		this.filterBy('user_ip_hash', userIpHash);
		this.filterRaw(`${RatingEntity.NAME}.user_id IS NULL`);

		return this;
	}
}

export const getRatingRepository = () =>
	dataSource.getRepository(RatingEntity).extend({
		createQuery() {
			return new RatingQuery(this);
		},
	});
