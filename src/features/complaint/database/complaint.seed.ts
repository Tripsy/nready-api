import {
	isDirectRun,
	loadIds,
	type Random,
	randomInt,
	randomPastDate,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ArticleEntity from '@/features/article/article.entity';
import CommentEntity from '@/features/comment/comment.entity';
import ComplaintEntity, {
	type ComplaintEntityType,
	ComplaintEntityTypeEnum,
	type ComplaintReason,
	ComplaintReasonEnum,
} from '@/features/complaint/complaint.entity';
import UserEntity from '@/features/user/user.entity';
import type { EntityId } from '@/shared/types/entity-id.type';

/** Targets to spread complaints over; enough to give the moderation queue something to page. */
const TARGET_ARTICLES = 4;
const TARGET_COMMENTS = 6;
const MIN_REPORTERS_PER_TARGET = 1;
const MAX_REPORTERS_PER_TARGET = 3;
/** Every third complaint has already been dealt with, so both halves of the queue are populated. */
const RESOLVED_EVERY = 3;

const REASONS: readonly ComplaintReason[] = Object.values(ComplaintReasonEnum);

/**
 * The natural key, and the same triple `UQ_complaint_user` is built on: one complaint per reporter
 * per target. The table has no free column that is unique per seeded row - a complaint is
 * deliberately free to repeat every one of its other values.
 */
function complaintKey(
	entityType: ComplaintEntityType,
	entityId: EntityId,
	userId: EntityId,
): string {
	return `${entityType}:${entityId}:${userId}`;
}

/**
 * Complaints against articles and comments, which are the two targets the enum allows and the two
 * that have demo data of their own. Seeding against ids that are not there would produce rows
 * pointing at nothing, which is exactly what the missing foreign key on a polymorphic target cannot
 * prevent.
 */
export const complaintSeed: SeedDefinition = {
	name: 'complaint',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(ComplaintEntity);

		const articleIds = (await loadIds(manager, ArticleEntity)).slice(
			0,
			TARGET_ARTICLES,
		);
		const commentIds = (await loadIds(manager, CommentEntity)).slice(
			0,
			TARGET_COMMENTS,
		);
		const userIds = await loadIds(manager, UserEntity);

		if (
			userIds.length === 0 ||
			(articleIds.length === 0 && commentIds.length === 0)
		) {
			return {
				entity: 'complaint',
				alreadyPresent: 0,
				inserted: 0,
				target: 0,
				tableTotal: await repository.count(),
			};
		}

		/*
		 * `withDeleted` on purpose. The unique is scoped to live rows, so a withdrawn complaint
		 * would let this insert a second one - and a re-run would then keep filing the same
		 * complaint again on every pass.
		 */
		const existingRows = await repository.find({
			select: { entity_type: true, entity_id: true, user_id: true },
			withDeleted: true,
		});

		const existingKeys = new Set(
			existingRows.map((row) =>
				complaintKey(row.entity_type, row.entity_id, row.user_id),
			),
		);

		const targets: { type: ComplaintEntityType; ids: EntityId[] }[] = [
			{ type: ComplaintEntityTypeEnum.ARTICLE, ids: articleIds },
			{ type: ComplaintEntityTypeEnum.COMMENT, ids: commentIds },
		];

		const candidates: Partial<ComplaintEntity>[] = [];
		let index = 0;

		for (const target of targets) {
			for (const entityId of target.ids) {
				const reporterCount = Math.min(
					randomInt(
						random,
						MIN_REPORTERS_PER_TARGET,
						MAX_REPORTERS_PER_TARGET,
					),
					userIds.length,
				);

				// Reporters are taken in order rather than drawn, so no target can pick the same
				// account twice within one run and collide with itself on insert.
				for (
					let reporter = 0;
					reporter < reporterCount;
					reporter++, index++
				) {
					candidates.push(
						buildComplaint({
							entityType: target.type,
							entityId,
							userId: userIds[reporter],
							moderatorId: userIds[0],
							index,
							random,
						}),
					);
				}
			}
		}

		const pending = candidates.filter((candidate) => {
			const key = complaintKey(
				candidate.entity_type as ComplaintEntityType,
				candidate.entity_id as EntityId,
				candidate.user_id as EntityId,
			);

			return !existingKeys.has(key);
		});

		if (pending.length > 0) {
			await repository.save(pending, { chunk: 50 });
		}

		return {
			entity: 'complaint',
			alreadyPresent: candidates.length - pending.length,
			inserted: pending.length,
			target: candidates.length,
			tableTotal: await repository.count(),
		};
	},
};

type BuildComplaintOptions = {
	entityType: ComplaintEntityType;
	entityId: EntityId;
	userId: EntityId;
	moderatorId: EntityId;
	index: number;
	random: Random;
};

/**
 * `CHK_complaint_resolved` ties the flag to the timestamp, so a resolved row carries both and an
 * open one carries neither.
 */
function buildComplaint(
	options: BuildComplaintOptions,
): Partial<ComplaintEntity> {
	const { entityType, entityId, userId, moderatorId, index, random } =
		options;

	const isResolved = index % RESOLVED_EVERY === 0;

	return {
		entity_type: entityType,
		entity_id: entityId,
		user_id: userId,
		reason: randomPick(random, REASONS),
		description: `Seeded report ${sequenceLabel(index)} against ${entityType} ${entityId}.`,
		is_resolved: isResolved,
		resolved_at: isResolved ? randomPastDate(random, 30) : null,
		resolved_by: isResolved ? moderatorId : null,
	};
}

if (isDirectRun(import.meta.url)) {
	await runSeedFile(complaintSeed);
}
