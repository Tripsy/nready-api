import { QueryFailedError } from 'typeorm';
import { lang } from '@/config/message.setup';
import { CustomError, NotFoundError } from '@/exceptions';
import type RatingEntity from '@/features/rating/rating.entity';
import type {
	RatingEmoji,
	RatingEntityType,
} from '@/features/rating/rating.entity';
import { RatingTypeEnum } from '@/features/rating/rating.entity';
import { getRatingRepository } from '@/features/rating/rating.repository';
import type { RatingValidator } from '@/features/rating/rating.validator';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	isParticipationAllowed,
	ParticipationEnum,
} from '@/shared/registries/target-participation.registry';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/**
 * Who is casting or withdrawing a rating. `user_id` is null for a guest; `user_ip_hash` is always
 * present, which is what lets a guest be addressed at all - see the entity for why the column is
 * required even when an account is known.
 */
export type RatingOwner = {
	user_id: number | null;
	user_ip_hash: string;
};

export type RatingTarget = {
	entity_type: RatingEntityType;
	entity_id: number;
};

export type RatingSummary = {
	total: number;
	like: {
		up: number;
		down: number;
		score: number;
	};
	stars: {
		count: number;
		average: number;
		/** How many rows carry each score, keyed 1-5; absent scores are absent keys. */
		distribution: Record<number, number>;
	};
	emoji: Partial<Record<RatingEmoji, number>>;
};

/** One `(type, value, reaction)` group of the summary query. */
type RatingSummaryRow = {
	type: string;
	value: number | null;
	reaction: RatingEmoji | null;
	count: string;
};

export class RatingService {
	constructor(private repository: ReturnType<typeof getRatingRepository>) {}

	/**
	 * @description Used in `create` method from the public controller
	 *
	 * Strictly an insert, never an upsert: a caller who already holds a rating on this target is
	 * told so (see `asConflict`) and changes it through `updateOwn`. Silently folding the two
	 * would also swallow `UQ_rating_ip`, whose collision is somebody *else* behind the same
	 * address - a row this caller must not overwrite.
	 */
	public async create(
		data: ValidatorOutput<RatingValidator, 'create'>,
		owner: RatingOwner,
	): Promise<RatingEntity> {
		/*
		 * The target decides whether it still takes ratings - an article whose editor turned
		 * them off answers no, and one that is gone answers no for everything. A target with
		 * no resolver registered is open, which is every one of them but `article`.
		 */
		const isAccepted = await isParticipationAllowed(
			data.entity_type,
			data.entity_id,
			ParticipationEnum.RATING,
		);

		if (!isAccepted) {
			throw new CustomError(403, lang('rating.error.not_accepted'));
		}

		const isEmoji = data.type === RatingTypeEnum.EMOJI;

		try {
			return await this.repository.save(
				this.repository.create({
					entity_type: data.entity_type,
					entity_id: data.entity_id,
					type: data.type,
					value: isEmoji ? null : data.value,
					reaction: isEmoji ? data.reaction : null,
					user_id: owner.user_id,
					user_ip_hash: owner.user_ip_hash,
				}),
			);
		} catch (error) {
			throw this.asConflict(error);
		}
	}

	/**
	 * Both uniques are reachable from one insert and they say different things: `UQ_rating_user`
	 * means this account already voted, `UQ_rating_ip` means this address did - possibly somebody
	 * else behind the same NAT. A caller can act on the first (withdraw, then vote again) and not
	 * on the second, so the two must not collapse into one message.
	 *
	 * Anything that is not a unique violation is returned untouched, so the original error keeps
	 * its stack and reaches the error handler as itself.
	 */
	private asConflict(error: unknown): unknown {
		if (!RepositoryAbstract.isUniqueViolation(error)) {
			return error;
		}

		// Only Postgres names the constraint on the driver error; without a name the account
		// message is the safer of the two, since it describes an action the caller can take.
		const constraint =
			error instanceof QueryFailedError
				? (error.driverError?.constraint as string | undefined)
				: undefined;

		return new CustomError(
			409,
			constraint === 'UQ_rating_ip'
				? lang('rating.error.already_rated_ip')
				: lang('rating.error.already_rated'),
		);
	}

	/**
	 * @description Used in `update` method from the public controller
	 *
	 * Addressed the way `deleteOwn` is - by target plus the identity resolved from the request,
	 * never by id - so the row this resolves to is by construction one the caller may edit, and
	 * no ownership check is left to a later step.
	 *
	 * `firstOrFail` answers 404 when the caller holds no rating on this target, which is the same
	 * answer somebody else's rating gives; a caller learns nothing about rows they cannot see.
	 *
	 * Only `value` / `reaction` move. The columns in the two uniques are the ones that addressed
	 * the row, so this write cannot collide and needs none of `create`'s conflict handling.
	 */
	public async updateOwn(
		data: ValidatorOutput<RatingValidator, 'update'>,
		owner: RatingOwner,
	): Promise<RatingEntity> {
		const entry = await this.repository
			.createQuery()
			.filterByTarget(data.entity_type, data.entity_id, data.type)
			.filterByOwner(owner.user_id, owner.user_ip_hash)
			.firstOrFail();

		const isEmoji = data.type === RatingTypeEnum.EMOJI;

		entry.value = isEmoji ? null : data.value;
		entry.reaction = isEmoji ? data.reaction : null;

		return this.repository.save(entry);
	}

	/**
	 * @description Used in `delete` method from the dashboard controller
	 *
	 * Hard, and it has to be: `rating` has no `deleted_at` to soft-delete into, and a row that
	 * lingered would keep counting towards both uniques and every aggregate.
	 */
	public async delete(id: number): Promise<void> {
		await this.repository.createQuery().filterById(id).delete(false);
	}

	/**
	 * @description Used in `delete` method from the public controller
	 *
	 * Scoped to the caller's own row by `filterByOwner`, so a caller can only ever withdraw what
	 * they cast. A target nobody rated raises the repository's 404 - the same answer somebody
	 * else's rating gives, which is what keeps this from reporting on rows the caller cannot see.
	 */
	public async deleteOwn(
		data: ValidatorOutput<RatingValidator, 'publicDelete'>,
		owner: RatingOwner,
	): Promise<void> {
		await this.repository
			.createQuery()
			.filterByTarget(data.entity_type, data.entity_id, data.type)
			.filterByOwner(owner.user_id, owner.user_ip_hash)
			.delete(false);
	}

	/**
	 * @description Used by `RatingListener`, on `entityRemoved`
	 *
	 * Ratings left pointing at targets that no longer exist. `(entity_type, entity_id)` carries no
	 * foreign key, so nothing removes them when the target goes - the feature that owned it
	 * announces the removal and this clears what was cast on it.
	 *
	 * Hard, like every other delete on this table: there is no `deleted_at` to soft-delete into,
	 * and a lingering row would keep counting towards both uniques and every aggregate.
	 */
	public async deleteByTargets(
		entityType: RatingEntityType,
		entityIds: number[],
	): Promise<void> {
		if (entityIds.length === 0) {
			return;
		}

		try {
			await this.repository
				.createQuery()
				.filterBy('entity_type', entityType)
				.filterBy('entity_id', entityIds, 'IN')
				.delete(false, true);
		} catch (error) {
			/*
			 * A target nobody rated is the ordinary case, and `RepositoryAbstract.delete` reports
			 * "nothing matched" as a 404 - meaningful when a caller named one row, noise when the
			 * caller is a cleanup sweeping ids it has no expectations about.
			 */
			if (!(error instanceof NotFoundError)) {
				throw error;
			}
		}
	}

	/**
	 * @description Used in `read` method from the dashboard controller
	 */
	public getEntryData(id: number): Promise<RatingEntity> {
		return this.repository
			.createQuery()
			.join('rating.user', 'user', 'LEFT')
			.select([
				'rating.id',
				'rating.entity_type',
				'rating.entity_id',
				'rating.type',
				'rating.value',
				'rating.reaction',
				'rating.user_id',
				'rating.created_at',
				'rating.updated_at',

				'user.id',
				'user.name',
				'user.email',
			])
			.filterById(id)
			.firstOrFail();
	}

	/**
	 * @description Used in `find` method from the dashboard controller
	 *
	 * `user_ip_hash` is deliberately not selected: it identifies a visitor across every target
	 * they ever rated, and a moderation list has no use for it.
	 */
	public findByFilter(data: ValidatorOutput<RatingValidator, 'find'>) {
		return this.repository
			.createQuery()
			.join('rating.user', 'user', 'LEFT')
			.select([
				'rating.id',
				'rating.entity_type',
				'rating.entity_id',
				'rating.type',
				'rating.value',
				'rating.reaction',
				'rating.user_id',
				'rating.created_at',
				'rating.updated_at',

				'user.id',
				'user.name',
			])
			.filterByTarget(
				data.filter.entity_type,
				data.filter.entity_id,
				data.filter.type,
			)
			.filterBy('reaction', data.filter.reaction)
			.filterBy('user_id', data.filter.user_id)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.all(true);
	}

	/**
	 * @description Used in `read` method from the public controller
	 *
	 * One grouped query for the whole target rather than one per rating type; `foldSummary` turns
	 * those groups into the shape a widget renders.
	 *
	 * Reads members and guests together, which is what `IDX_rating_entity` exists for: the partial
	 * `UQ_rating_user` cannot serve a query that does not imply `user_id IS NOT NULL`.
	 */
	public async getSummary(data: RatingTarget): Promise<RatingSummary> {
		const rows = await this.repository
			.createQuery()
			.filterByTarget(data.entity_type, data.entity_id)
			.getQuery()
			.select('rating.type', 'type')
			.addSelect('rating.value', 'value')
			.addSelect('rating.reaction', 'reaction')
			.addSelect('COUNT(*)', 'count')
			.groupBy('rating.type')
			.addGroupBy('rating.value')
			.addGroupBy('rating.reaction')
			.getRawMany<RatingSummaryRow>();

		return RatingService.foldSummary(rows);
	}

	/**
	 * @description Used in `summaries` method from the public controller
	 *
	 * The same aggregate for a set of targets, in one query. A list of rated things - a page of
	 * comments, a feed of articles - would otherwise issue one request per row, which is the
	 * shape that turns a thread into a dozen round trips.
	 *
	 * Targets nobody has rated are absent from the result rather than present and empty: the
	 * caller knows which ids it asked about, and an empty summary is what a missing key means.
	 */
	public async getSummaries(
		entityType: RatingEntityType,
		entityIds: number[],
	): Promise<Record<number, RatingSummary>> {
		const rows = await this.repository
			.createQuery()
			.filterBy('entity_type', entityType)
			.filterBy('entity_id', entityIds, 'IN')
			.getQuery()
			.select('rating.entity_id', 'entity_id')
			.addSelect('rating.type', 'type')
			.addSelect('rating.value', 'value')
			.addSelect('rating.reaction', 'reaction')
			.addSelect('COUNT(*)', 'count')
			.groupBy('rating.entity_id')
			.addGroupBy('rating.type')
			.addGroupBy('rating.value')
			.addGroupBy('rating.reaction')
			.getRawMany<RatingSummaryRow & { entity_id: number }>();

		const grouped = new Map<number, RatingSummaryRow[]>();

		for (const row of rows) {
			const entityId = Number(row.entity_id);
			const bucket = grouped.get(entityId);

			if (bucket) {
				bucket.push(row);
			} else {
				grouped.set(entityId, [row]);
			}
		}

		const summaries: Record<number, RatingSummary> = {};

		for (const [entityId, bucket] of grouped) {
			summaries[entityId] = RatingService.foldSummary(bucket);
		}

		return summaries;
	}

	/**
	 * What the caller cast across a set of targets, keyed by target - the `own` half of the
	 * summary above, resolved in the same single query rather than per row.
	 */
	public async getOwnRatingsForTargets(
		entityType: RatingEntityType,
		entityIds: number[],
		owner: RatingOwner,
	): Promise<Record<number, RatingEntity[]>> {
		const entries = await this.repository
			.createQuery()
			.select([
				'rating.id',
				'rating.entity_id',
				'rating.type',
				'rating.value',
				'rating.reaction',
			])
			.filterBy('entity_type', entityType)
			.filterBy('entity_id', entityIds, 'IN')
			.filterByOwner(owner.user_id, owner.user_ip_hash)
			.all();

		const own: Record<number, RatingEntity[]> = {};

		for (const entry of entries) {
			const bucket = own[entry.entity_id];

			if (bucket) {
				bucket.push(entry);
			} else {
				own[entry.entity_id] = [entry];
			}
		}

		return own;
	}

	/**
	 * Folds one target's `(type, value, reaction)` groups into the shape a widget renders.
	 *
	 * At most a dozen rows per target - three like directions, five scores, one per reaction -
	 * so this runs on a set that cannot grow with traffic.
	 */
	private static foldSummary(rows: RatingSummaryRow[]): RatingSummary {
		const summary: RatingSummary = {
			total: 0,
			like: { up: 0, down: 0, score: 0 },
			stars: { count: 0, average: 0, distribution: {} },
			emoji: {},
		};

		let starsSum = 0;

		for (const row of rows) {
			// The driver returns an aggregate as a string - `COUNT(*)` is `bigint` in Postgres,
			// which node-postgres does not narrow to a JS number on its own.
			const count = Number(row.count);

			summary.total += count;

			switch (row.type) {
				case RatingTypeEnum.LIKE:
					if (row.value === 1) {
						summary.like.up += count;
					} else {
						summary.like.down += count;
					}
					break;

				case RatingTypeEnum.STARS:
					if (row.value === null) {
						break;
					}

					summary.stars.count += count;
					summary.stars.distribution[row.value] = count;
					starsSum += row.value * count;
					break;

				case RatingTypeEnum.EMOJI:
					if (row.reaction) {
						summary.emoji[row.reaction] = count;
					}
					break;
			}
		}

		summary.like.score = summary.like.up - summary.like.down;

		if (summary.stars.count > 0) {
			summary.stars.average =
				Math.round((starsSum / summary.stars.count) * 100) / 100;
		}

		return summary;
	}

	/**
	 * What the caller themselves cast on this target, so the widget that renders the summary can
	 * show which button is already pressed. At most one row per rating type, by both uniques.
	 */
	public getOwnRatings(
		data: RatingTarget,
		owner: RatingOwner,
	): Promise<RatingEntity[]> {
		return this.repository
			.createQuery()
			.select([
				'rating.id',
				'rating.type',
				'rating.value',
				'rating.reaction',
				'rating.created_at',
				'rating.updated_at',
			])
			.filterByTarget(data.entity_type, data.entity_id)
			.filterByOwner(owner.user_id, owner.user_ip_hash)
			.all();
	}
}

export const ratingService = new RatingService(getRatingRepository());
