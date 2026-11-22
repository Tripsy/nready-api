import type { Repository } from 'typeorm';
import dataSource from '@/config/data-source.config';
import CommentEntity from '@/features/comment/comment.entity';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

export class CommentQuery extends RepositoryAbstract<CommentEntity> {
	constructor(repository: Repository<CommentEntity>) {
		super(repository, CommentEntity.NAME);
	}

	/**
	 * One level of the tree. `null` means the roots, which is a different condition from "any
	 * parent" - hence the explicit tri-state rather than a `filterBy` that drops a null value.
	 *
	 * `undefined` leaves the filter off entirely, which is what a dashboard listing wants: it
	 * shows roots and replies together.
	 */
	filterByParent(parentId?: EntityId | null): this {
		if (parentId === undefined) {
			return this;
		}

		if (parentId === null) {
			return this.filterRaw(`${CommentEntity.NAME}.parent_id IS NULL`);
		}

		return this.filterBy('parent_id', parentId);
	}

	/**
	 * Narrows to the rows the caller may speak for, which is what makes a public edit or delete
	 * safe without a second ownership check downstream.
	 *
	 * A signed-in caller is matched by `user_id` alone - they may well be writing from a different
	 * address than the one they commented from.
	 *
	 * A guest is matched by address **and** `user_id IS NULL`. Without that second condition anyone
	 * sharing an address - a household, an office, a carrier's NAT - could edit a signed-in user's
	 * comment, since nothing stops both rows from carrying the same hash.
	 */
	filterByOwner(userId: EntityId | null, userIpHash: string): this {
		if (userId) {
			this.filterBy('user_id', userId);

			return this;
		}

		this.filterBy('user_ip_hash', userIpHash);
		this.filterRaw(`${CommentEntity.NAME}.user_id IS NULL`);

		return this;
	}

	/**
	 * The moderation search box: the text itself and the name a guest signed it with. `ILIKE` over
	 * a full-text index on purpose - a moderator searches for a fragment ("http", a slur, half a
	 * word), which `to_tsquery` cannot express and stemming would defeat.
	 */
	filterByTerm(term?: string | null): this {
		if (!term) {
			return this;
		}

		this.filterAny([
			{ column: 'content', value: term, operator: 'ILIKE' },
			{ column: 'guest_name', value: term, operator: 'ILIKE' },
		]);

		return this;
	}
}

export const getCommentRepository = () =>
	dataSource.getRepository(CommentEntity).extend({
		createQuery() {
			return new CommentQuery(this);
		},
	});
