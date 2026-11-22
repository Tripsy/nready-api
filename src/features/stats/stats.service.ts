/**
 * **This feature is expected to be rewritten per project.** Unlike the rest of the boilerplate it
 * is deliberately coupled: it imports `article`, `cash-flow`, `client`, `comment`, `complaint`,
 * `log-history` and `user` directly, because a dashboard is a statement about which features a
 * particular product cares about. Removing one of those features means editing this file - that is
 * the intended cost, not an oversight, and it is why no registry indirection was added.
 *
 * A project started from this boilerplate should treat `stats` as a template: keep the shape
 * (policy, cache, one method per figure) and swap the figures for the ones it actually has.
 */
import type { ObjectLiteral } from 'typeorm';
import { ArticleStatusEnum } from '@/features/article/article.entity';
import { getArticleRepository } from '@/features/article/article.repository';
import {
	type CashFlowDirection,
	CashFlowDirectionEnum,
	CashFlowStatusEnum,
	GROSS_AMOUNT_BASE_CURRENCY_EXPRESSION,
} from '@/features/cash-flow/cash-flow.entity';
import { getCashFlowRepository } from '@/features/cash-flow/cash-flow.repository';
import { ClientStatusEnum } from '@/features/client/client.entity';
import { getClientRepository } from '@/features/client/client.repository';
import { CommentStatusEnum } from '@/features/comment/comment.entity';
import { getCommentRepository } from '@/features/comment/comment.repository';
import { getComplaintRepository } from '@/features/complaint/complaint.repository';
import { getLogHistoryRepository } from '@/features/log-history/log-history.repository';
import { UserStatusEnum } from '@/features/user/user.entity';
import { getUserRepository } from '@/features/user/user.repository';
import {
	createCurrentDate,
	createPastDate,
	getMonthIntervalBasedOnCurrentDate,
} from '@/helpers/date.helper';
import type RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';

/** Rows the dashboard's recent-activity panel shows. It renders the list whole, without paging. */
const RECENT_ACTIVITY_LIMIT = 10;

/** Window the "created recently" counts cover - a rolling day, not since midnight. */
const RECENT_WINDOW_SECONDS = 24 * 60 * 60;

/** Size of the combined moderation queue the dashboard shows. */
const PENDING_REVIEW_LIMIT = 10;

/** Features that contribute to the "waiting for review" queue. */
export const PENDING_REVIEW_ENTITIES = [
	'user',
	'client',
	'article',
	'comment',
	'complaint',
] as const;

export type PendingReviewEntity = (typeof PENDING_REVIEW_ENTITIES)[number];

/** One row of the "waiting for review" queue. */
export type PendingReviewEntry = {
	id: EntityId;
	/** Best label the row can offer cheaply; `null` where the feature has none. */
	label: string | null;
	created_at: Date;
};

/**
 * A feature's slice of the queue. `total` is the real backlog, not `entries.length` - the list is
 * capped at `PENDING_REVIEW_LIMIT`, and a queue that reports "10" when 40 are waiting is worse
 * than useless.
 */
export type PendingReviewGroup = {
	entries: PendingReviewEntry[];
	total: number;
};

/**
 * The slice of a feature repository `getRecentCounts` needs. Every `get<Feature>Repository()`
 * returns a different extended TypeORM repository, but each one's `createQuery()` yields a
 * `RepositoryAbstract`, which is all a row count depends on.
 */
type CountableRepository = {
	createQuery: () => Pick<
		RepositoryAbstract<ObjectLiteral>,
		'filterByRange' | 'count'
	>;
};

// Month-over-month percentage change and its direction. Returns the raw
// (unrounded) change so each stat method formats/rounds it as it needs.
function computeTrend(
	current: number,
	previous: number,
): { change: number; trend: 'up' | 'down' } {
	// With no previous baseline any non-zero current value is a full swing;
	// keep the sign so a negative current reads as -100% and not as "no change".
	const change =
		previous === 0
			? current === 0
				? 0
				: Math.sign(current) * 100
			: ((current - previous) / previous) * 100;

	return {
		change,
		trend: change >= 0 ? 'up' : 'down',
	};
}

export class StatsService {
	constructor(
		private logHistoryRepository: ReturnType<
			typeof getLogHistoryRepository
		>,
		private cashFlowRepository: ReturnType<typeof getCashFlowRepository>,
		private userRepository: ReturnType<typeof getUserRepository>,
		private clientRepository: ReturnType<typeof getClientRepository>,
		private articleRepository: ReturnType<typeof getArticleRepository>,
		private commentRepository: ReturnType<typeof getCommentRepository>,
		private complaintRepository: ReturnType<typeof getComplaintRepository>,
	) {}

	public getRecentActivity() {
		return this.logHistoryRepository
			.createQuery()
			.orderBy('log_history.id', 'DESC')
			.pagination(1, RECENT_ACTIVITY_LIMIT)
			.all();
	}

	/**
	 * How many rows each tracked feature gained in the last `RECENT_WINDOW_SECONDS`.
	 *
	 * Counts exclude soft-deleted rows, which is the repository default: something created and
	 * then deleted inside the window is not something the dashboard should still be pointing at.
	 * `comment` is hard-deleted and has no `deleted_at`, so it is unaffected either way.
	 */
	public async getRecentCounts() {
		const since = createPastDate(RECENT_WINDOW_SECONDS);
		const until = createCurrentDate();

		const countSince = (repository: CountableRepository) =>
			repository
				.createQuery()
				.filterByRange('created_at', since, until)
				.count();

		const [user, client, article, comment, complaint] = await Promise.all([
			countSince(this.userRepository),
			countSince(this.clientRepository),
			countSince(this.articleRepository),
			countSince(this.commentRepository),
			countSince(this.complaintRepository),
		]);

		return { user, client, article, comment, complaint };
	}

	/**
	 * Each feature's backlog of rows waiting on someone to act, newest first.
	 *
	 * "Waiting" is defined per feature, because the features disagree about how they say it:
	 * `user`/`client`/`article` use `status = pending`, `comment` uses `pending` *or* `flagged`
	 * (three distinct reporters flag a comment automatically, and that needs a decision just as
	 * much as a new one does), and `complaint` has no status at all - its queue flag is
	 * `is_resolved`, which `IDX_complaint_open` is built around.
	 *
	 * `article` returns no label: its title lives per-language in `article_content`, and a join
	 * plus a language decision is more than a queue line is worth.
	 */
	public async getPendingReview(): Promise<
		Record<PendingReviewEntity, PendingReviewGroup>
	> {
		const [users, clients, articles, comments, complaints] =
			await Promise.all([
				this.userRepository
					.createQuery()
					.select(['user.name', 'user.created_at'])
					.filterByStatus(UserStatusEnum.PENDING)
					.orderBy('user.id', 'DESC')
					.pagination(1, PENDING_REVIEW_LIMIT)
					.all(true),
				this.clientRepository
					.createQuery()
					.select([
						'client.company_name',
						'client.person_name',
						'client.created_at',
					])
					.filterByStatus(ClientStatusEnum.PENDING)
					.orderBy('client.id', 'DESC')
					.pagination(1, PENDING_REVIEW_LIMIT)
					.all(true),
				this.articleRepository
					.createQuery()
					.select(['article.created_at'])
					.filterByStatus(ArticleStatusEnum.PENDING)
					.orderBy('article.id', 'DESC')
					.pagination(1, PENDING_REVIEW_LIMIT)
					.all(true),
				this.commentRepository
					.createQuery()
					.select(['comment.content', 'comment.created_at'])
					.filterBy(
						'status',
						[CommentStatusEnum.PENDING, CommentStatusEnum.FLAGGED],
						'IN',
					)
					.orderBy('comment.id', 'DESC')
					.pagination(1, PENDING_REVIEW_LIMIT)
					.all(true),
				this.complaintRepository
					.createQuery()
					.select(['complaint.reason', 'complaint.created_at'])
					.filterByBoolean('is_resolved', false)
					.orderBy('complaint.id', 'DESC')
					.pagination(1, PENDING_REVIEW_LIMIT)
					.all(true),
			]);

		const toGroup = <TRow extends { id: EntityId; created_at: Date }>(
			[rows, total]: [TRow[], number],
			label: (row: TRow) => string | null,
		): PendingReviewGroup => ({
			entries: rows.map((row) => ({
				id: row.id,
				label: label(row),
				created_at: row.created_at,
			})),
			total,
		});

		return {
			user: toGroup(users, (row) => row.name),
			client: toGroup(
				clients,
				(row) => row.company_name ?? row.person_name,
			),
			article: toGroup(articles, () => null),
			comment: toGroup(comments, (row) => row.content),
			complaint: toGroup(complaints, (row) => row.reason),
		};
	}

	/**
	 * Month-to-date total for one cash-flow direction, against the same span of the previous
	 * month. Only COMPLETED entries count - pending money is not money yet.
	 */
	public async getSumAmount(direction: CashFlowDirection) {
		const thisMonth = getMonthIntervalBasedOnCurrentDate(0);
		const prevMonth = getMonthIntervalBasedOnCurrentDate(1);

		const buildQuery = (start: Date, end: Date) =>
			this.cashFlowRepository
				.createQuery()
				.filterByRange('created_at', start, end)
				.select(
					[
						`SUM(${GROSS_AMOUNT_BASE_CURRENCY_EXPRESSION('cash_flow')}) AS total_amount`,
					],
					false,
				)
				.filterBy('direction', direction)
				.filterByStatus(CashFlowStatusEnum.COMPLETED)
				.firstRaw();

		const [currentResult, previousResult] = await Promise.all([
			buildQuery(thisMonth.start, thisMonth.end),
			buildQuery(prevMonth.start, prevMonth.end),
		]);

		// `out` rows sum to a negative gross amount, so normalize to the
		// displayed (positive) magnitude *before* computing the trend -
		// otherwise the "no previous month" branch sees a negative value.
		const sign = direction === CashFlowDirectionEnum.IN ? 1 : -1;
		const currentValue = Number(currentResult?.total_amount ?? 0) * sign;
		const previousValue = Number(previousResult?.total_amount ?? 0) * sign;

		const { change, trend } = computeTrend(currentValue, previousValue);

		return {
			value: Number(currentValue.toFixed(2)),
			change: Number(change.toFixed(1)),
			trend,
		};
	}
}

export const statsService = new StatsService(
	getLogHistoryRepository(),
	getCashFlowRepository(),
	getUserRepository(),
	getClientRepository(),
	getArticleRepository(),
	getCommentRepository(),
	getComplaintRepository(),
);
