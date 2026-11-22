import type { EntityManager } from 'typeorm';
import {
	isDirectRun,
	loadIds,
	type Random,
	randomPastDate,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ArticleEntity from '@/features/article/article.entity';
import CommentEntity, {
	CommentEntityTypeEnum,
	type CommentStatus,
	CommentStatusEnum,
	type CommentType,
	CommentTypeEnum,
} from '@/features/comment/comment.entity';
import UserEntity from '@/features/user/user.entity';
import { hashIp } from '@/helpers/security.helper';
import type { EntityId } from '@/shared/types/entity-id.type';

/** Articles to spread comments over; enough to give a moderation listing something to page. */
const TARGET_ARTICLES = 6;
const ROOTS_PER_ARTICLE = 4;
/** Replies hang off the first approved root of each article, so threads have depth to render. */
const REPLIES_PER_THREAD = 3;
/** Every third root is written by a visitor with no account, populating the guest half. */
const GUEST_EVERY = 3;

const COMMENT_TYPES: readonly CommentType[] = Object.values(CommentTypeEnum);

/**
 * Skewed towards `approved`, which is what a moderated thread looks like once it has settled, while
 * still leaving a queue for the dashboard to work through.
 */
const ROOT_STATUSES: readonly CommentStatus[] = [
	CommentStatusEnum.APPROVED,
	CommentStatusEnum.APPROVED,
	CommentStatusEnum.APPROVED,
	CommentStatusEnum.PENDING,
	CommentStatusEnum.REJECTED,
	CommentStatusEnum.SPAM,
	CommentStatusEnum.FLAGGED,
];

/**
 * The natural key. `content` carries it because the table has no other column that is unique per
 * seeded row - a comment is deliberately free to repeat every one of its other values - and the
 * text is deterministic in the indices it is built from, so a re-run rebuilds exactly the same keys.
 */
function rootContent(articleId: EntityId, index: number): string {
	return `Seeded comment ${sequenceLabel(index)} on article ${articleId}.`;
}

function replyContent(articleId: EntityId, index: number): string {
	return `Seeded reply ${sequenceLabel(index)} on article ${articleId}.`;
}

/** Members and guests draw from different documentation ranges (RFC 5737) so the two never meet. */
function memberIpHash(index: number): string {
	return hashIp(`198.51.100.${index % 256}`);
}

function guestIpHash(index: number): string {
	return hashIp(`203.0.113.${index % 256}`);
}

/**
 * Comments on articles only, which is every target the application actually uses - `review` is a
 * value the enum still carries and nothing writes. Seeding against ids from an unused target would
 * produce rows pointing at nothing, which is exactly what the missing foreign key on a polymorphic
 * target cannot prevent.
 */
export const commentSeed: SeedDefinition = {
	name: 'comment',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const repository = manager.getRepository(CommentEntity);

		const articleIds = (await loadIds(manager, ArticleEntity)).slice(
			0,
			TARGET_ARTICLES,
		);
		const userIds = await loadIds(manager, UserEntity);

		if (articleIds.length === 0 || userIds.length === 0) {
			return {
				entity: 'comment',
				alreadyPresent: 0,
				inserted: 0,
				target: 0,
				tableTotal: await repository.count(),
			};
		}

		const existingKeys = new Set(
			(await repository.find({ select: { content: true } })).map(
				(row) => row.content,
			),
		);

		// Roots first: a reply needs its parent's id, which only exists once the parent is stored.
		const rootCandidates: Partial<CommentEntity>[] = [];

		for (const articleId of articleIds) {
			for (let index = 0; index < ROOTS_PER_ARTICLE; index++) {
				rootCandidates.push(
					buildComment({
						articleId,
						content: rootContent(articleId, index),
						// The first root of every article is the pinned one, so it is approved
						// rather than drawn - a pinned comment nobody can see demonstrates
						// nothing about the ordering it exists to drive.
						status:
							index === 0
								? CommentStatusEnum.APPROVED
								: randomPick(random, ROOT_STATUSES),
						index,
						userIds,
						random,
					}),
				);
			}
		}

		const pendingRoots = rootCandidates.filter(
			(candidate) => !existingKeys.has(candidate.content as string),
		);

		if (pendingRoots.length > 0) {
			await repository.save(pendingRoots, { chunk: 50 });
		}

		// The thread each article's replies hang from: approved, because `CommentService` refuses a
		// reply to anything else and seeded data has no business contradicting the service.
		const threadRoots = await repository.find({
			select: { id: true, entity_id: true },
			where: {
				entity_type: CommentEntityTypeEnum.ARTICLE,
				status: CommentStatusEnum.APPROVED,
			},
			order: { id: 'ASC' },
		});

		const rootByArticle = new Map<EntityId, EntityId>();

		for (const root of threadRoots) {
			if (!rootByArticle.has(root.entity_id)) {
				rootByArticle.set(root.entity_id, root.id);
			}
		}

		const replyCandidates: Partial<CommentEntity>[] = [];

		for (const articleId of articleIds) {
			const parentId = rootByArticle.get(articleId);

			if (!parentId) {
				continue;
			}

			for (let index = 0; index < REPLIES_PER_THREAD; index++) {
				replyCandidates.push({
					...buildComment({
						articleId,
						content: replyContent(articleId, index),
						status: CommentStatusEnum.APPROVED,
						index: index + ROOTS_PER_ARTICLE,
						userIds,
						random,
					}),
					parent_id: parentId,
				});
			}
		}

		const pendingReplies = replyCandidates.filter(
			(candidate) => !existingKeys.has(candidate.content as string),
		);

		if (pendingReplies.length > 0) {
			await repository.save(pendingReplies, { chunk: 50 });
		}

		await syncReplyCounts(manager, [...rootByArticle.values()]);

		const target = rootCandidates.length + replyCandidates.length;
		const inserted = pendingRoots.length + pendingReplies.length;

		return {
			entity: 'comment',
			alreadyPresent: target - inserted,
			inserted: inserted,
			target: target,
			tableTotal: await repository.count(),
		};
	},
};

/**
 * Recomputes `reply_count` from the rows actually stored, rather than counting what this run
 * inserted. The seed tops up, so a second run inserts nothing and must still leave the counter
 * right - incrementing per inserted row would drift on every re-run.
 *
 * Approved children only, which is what `CommentService` maintains: the counter sits next to a
 * public list that shows nothing else.
 */
async function syncReplyCounts(
	manager: EntityManager,
	parentIds: EntityId[],
): Promise<void> {
	if (parentIds.length === 0) {
		return;
	}

	await manager.query(
		`UPDATE "${CommentEntity.NAME}" parent
		 SET reply_count = (
			SELECT COUNT(*)
			FROM "${CommentEntity.NAME}" child
			WHERE child.parent_id = parent.id
			  AND child.status = $2
		 )
		 WHERE parent.id = ANY($1)`,
		[parentIds, CommentStatusEnum.APPROVED],
	);
}

type BuildCommentOptions = {
	articleId: EntityId;
	content: string;
	status: CommentStatus;
	index: number;
	userIds: EntityId[];
	random: Random;
};

/**
 * `CHK_comment_author` requires either an account or a name and an email, so the guest branch fills
 * both and the member branch neither - a member is identified by their account.
 */
function buildComment(options: BuildCommentOptions): Partial<CommentEntity> {
	const { articleId, content, status, index, userIds, random } = options;

	const isGuest = index % GUEST_EVERY === 0;
	const isModerated = status !== CommentStatusEnum.PENDING;
	const label = sequenceLabel(index);

	return {
		entity_type: CommentEntityTypeEnum.ARTICLE,
		entity_id: articleId,
		type: randomPick(random, COMMENT_TYPES),
		content: content,
		status: status,
		user_id: isGuest ? null : randomPick(random, userIds),
		user_ip_hash: isGuest ? guestIpHash(index) : memberIpHash(index),
		guest_name: isGuest ? `Guest ${label}` : null,
		guest_email: isGuest ? `guest.${label}@example.com` : null,
		guest_website: isGuest ? `https://example.com/${label}` : null,
		is_pinned: index === 0,
		is_staff: false,
		moderated_at: isModerated ? randomPastDate(random, 30) : null,
		moderated_by: isModerated ? userIds[0] : null,
		moderation_reason:
			status === CommentStatusEnum.SPAM ? 'Detected as spam' : null,
	};
}

if (isDirectRun(import.meta.url)) {
	await runSeedFile(commentSeed);
}
