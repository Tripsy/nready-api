import {
	isDirectRun,
	loadIds,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ArticleEntity from '@/features/article/article.entity';
import RatingEntity, {
	RatingEmojiEnum,
	RatingEntityTypeEnum,
	type RatingType,
	RatingTypeEnum,
} from '@/features/rating/rating.entity';
import UserEntity from '@/features/user/user.entity';
import { hashIp } from '@/helpers/security.helper';
import type { EntityId } from '@/shared/types/entity-id.type';

/** Articles to spread ratings over; enough to give a listing something to sort by. */
const TARGET_ARTICLES = 8;
const MIN_RATERS_PER_ARTICLE = 3;
const MAX_RATERS_PER_ARTICLE = 9;
/** Unregistered raters per article, so the guest half of the table is populated too. */
const GUESTS_PER_ARTICLE = 2;

const RATING_TYPES: readonly RatingType[] = Object.values(RatingTypeEnum);
const REACTIONS = Object.values(RatingEmojiEnum);

/**
 * Every rater on a target needs a distinct address: `UQ_rating_ip` rations a rating per origin, so
 * two seeded raters sharing a hash would collide instead of both being stored. Members and guests
 * draw from different documentation ranges (RFC 5737) so the two can never meet.
 */
function memberIpHash(index: number): string {
	return hashIp(`198.51.100.${index % 256}`);
}

function guestIpHash(index: number): string {
	return hashIp(`203.0.113.${index % 256}`);
}

/** Matches both uniques at once, since each seeded identity owns its own address. */
function ratingKey(
	entityId: EntityId,
	type: RatingType,
	userIpHash: string,
): string {
	return `${entityId}:${type}:${userIpHash}`;
}

/**
 * Ratings on articles only. `comment` is the other target the enum allows, but comments have no
 * demo data of their own - seeding against ids that are not there would produce rows pointing at
 * nothing, which is exactly what the missing foreign key on a polymorphic target cannot prevent.
 */
export const ratingSeed: SeedDefinition = {
	name: 'rating',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(RatingEntity);

		const articleIds = (await loadIds(manager, ArticleEntity)).slice(
			0,
			TARGET_ARTICLES,
		);
		const userIds = await loadIds(manager, UserEntity);

		if (articleIds.length === 0 || userIds.length === 0) {
			return {
				entity: 'rating',
				alreadyPresent: 0,
				inserted: 0,
				target: 0,
				tableTotal: await repository.count(),
			};
		}

		const existingRows = await repository.find({
			select: { entity_id: true, type: true, user_ip_hash: true },
		});

		const existingKeys = new Set(
			existingRows.map((row) =>
				ratingKey(row.entity_id, row.type, row.user_ip_hash),
			),
		);

		const candidates: Partial<RatingEntity>[] = [];

		for (const articleId of articleIds) {
			const raterCount = Math.min(
				randomInt(
					random,
					MIN_RATERS_PER_ARTICLE,
					MAX_RATERS_PER_ARTICLE,
				),
				userIds.length,
			);

			for (let index = 0; index < raterCount; index++) {
				candidates.push(
					buildRating(
						articleId,
						randomPick(random, RATING_TYPES),
						userIds[index],
						memberIpHash(index),
						random,
					),
				);
			}

			for (let index = 0; index < GUESTS_PER_ARTICLE; index++) {
				candidates.push(
					buildRating(
						articleId,
						randomPick(random, RATING_TYPES),
						null,
						guestIpHash(index),
						random,
					),
				);
			}
		}

		const pending = candidates.filter((candidate) => {
			const key = ratingKey(
				candidate.entity_id as EntityId,
				candidate.type as RatingType,
				candidate.user_ip_hash as string,
			);

			if (existingKeys.has(key)) {
				return false;
			}

			// Two candidates for the same target, type and address can be drawn within one run -
			// the same rater picked twice - and the second would fail the unique on insert.
			existingKeys.add(key);

			return true;
		});

		if (pending.length > 0) {
			await repository.save(pending, { chunk: 50 });
		}

		return {
			entity: 'rating',
			alreadyPresent: candidates.length - pending.length,
			inserted: pending.length,
			target: candidates.length,
			tableTotal: await repository.count(),
		};
	},
};

/**
 * `value` and `reaction` are mutually exclusive per `CHK_rating_value` / `CHK_rating_reaction`,
 * so the type decides which of the two is filled and the other is left null.
 */
function buildRating(
	entityId: EntityId,
	type: RatingType,
	userId: EntityId | null,
	userIpHash: string,
	random: () => number,
): Partial<RatingEntity> {
	return {
		entity_type: RatingEntityTypeEnum.ARTICLE,
		entity_id: entityId,
		type: type,
		// Skewed towards the positive end, which is what a rated article looks like in practice
		// and keeps the seeded average away from a flat 3.
		value:
			type === RatingTypeEnum.LIKE
				? randomInt(random, 0, 9) < 8
					? 1
					: -1
				: type === RatingTypeEnum.STARS
					? randomInt(random, 3, 5)
					: null,
		reaction:
			type === RatingTypeEnum.EMOJI
				? randomPick(random, REACTIONS)
				: null,
		user_id: userId,
		user_ip_hash: userIpHash,
	};
}

if (isDirectRun(import.meta.url)) {
	await runSeedFile(ratingSeed);
}
