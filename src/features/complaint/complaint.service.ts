import { eventEmitter } from '@/config/event.config';
import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError, NotFoundError } from '@/exceptions';
import type ComplaintEntity from '@/features/complaint/complaint.entity';
import type { ComplaintEntityType } from '@/features/complaint/complaint.entity';
import { getComplaintRepository } from '@/features/complaint/complaint.repository';
import type { ComplaintValidator } from '@/features/complaint/complaint.validator';
import { createCurrentDate } from '@/helpers/date.helper';
import RepositoryAbstract from '@/shared/abstracts/repository.abstract';
import {
	isParticipationAllowed,
	ParticipationEnum,
} from '@/shared/registries/target-participation.registry';
import type { ValidatorOutput } from '@/shared/types/mock.type';

/** The columns a reporter may see of their own complaint. The moderation trail is not among them. */
const OWN_COLUMNS: string[] = [
	'complaint.id',
	'complaint.entity_type',
	'complaint.entity_id',
	'complaint.reason',
	'complaint.description',
	'complaint.is_resolved',
	'complaint.created_at',
	'complaint.updated_at',
];

/** The columns a moderator works from, on top of the reporter's own. */
const MODERATION_COLUMNS: string[] = [
	'complaint.user_id',
	'complaint.resolved_at',
	'complaint.resolved_by',
	'complaint.deleted_at',
];

export class ComplaintService {
	constructor(
		private repository: ReturnType<typeof getComplaintRepository>,
	) {}

	/**
	 * @description Used in `create` method from the public controller
	 *
	 * Strictly an insert. A reporter who already has a live complaint on this target is told so
	 * rather than silently overwriting it - they amend it through `updateOwn` - because the second
	 * filing would otherwise erase the text a moderator may already be reading.
	 *
	 * `UQ_complaint_user` is scoped to live rows, so a withdrawn complaint leaves the slot free and
	 * the same reader may file again.
	 */
	public async create(
		data: ValidatorOutput<ComplaintValidator, 'create'>,
		userId: number,
	): Promise<ComplaintEntity> {
		/*
		 * The target decides whether it still takes reports - an article whose editor turned
		 * them off answers no, and one that is gone answers no for everything. A target with
		 * no resolver registered is open, which is every one of them but `article`.
		 */
		const isAccepted = await isParticipationAllowed(
			data.entity_type,
			data.entity_id,
			ParticipationEnum.COMPLAINT,
		);

		if (!isAccepted) {
			throw new CustomError(403, lang('complaint.error.not_accepted'));
		}

		try {
			const entry = await this.repository.save(
				this.repository.create({
					entity_type: data.entity_type,
					entity_id: data.entity_id,
					user_id: userId,
					reason: data.reason,
					description: data.description ?? null,
				}),
			);

			await this.announceFiled(entry.entity_type, entry.entity_id);

			return entry;
		} catch (error) {
			if (!RepositoryAbstract.isUniqueViolation(error)) {
				throw error;
			}

			throw new CustomError(
				409,
				lang('complaint.error.already_reported'),
			);
		}
	}

	/**
	 * Tells whoever owns the target that it has been reported, and by how many separate people.
	 *
	 * Only a filing announces: an amendment changes what a complaint says, not who stands behind
	 * it, and a withdrawal lowers a count that has already been acted on - a moderator's decision
	 * is not unmade by the reporter who asked for it. A restored complaint stays quiet for the same
	 * reason, being a decision in the other direction.
	 *
	 * Awaited rather than backgrounded: the count is the point of the event, and a listener acting
	 * on a stale one would flag the wrong target. What listeners then do with it is their own
	 * concern - `complaint` neither knows nor waits for it.
	 */
	private async announceFiled(
		entityType: ComplaintEntityType,
		entityId: number,
	): Promise<void> {
		eventEmitter.emit('complaintFiled', {
			entity_type: entityType,
			entity_id: entityId,
			reporters: await this.countDistinctReporters(entityType, entityId),
		});
	}

	/**
	 * How many separate people have live complaints against one target. Public because the
	 * dashboard has the same question to answer about a row it is showing.
	 */
	public countDistinctReporters(
		entityType: ComplaintEntityType,
		entityId: number,
	): Promise<number> {
		return this.repository
			.createQuery()
			.filterBy('entity_type', entityType)
			.filterBy('entity_id', entityId)
			.countDistinctReporters();
	}

	/**
	 * @description Used in `update` method from the public controller
	 *
	 * Amending a complaint already filed, while it is still open. Once a moderator has resolved it
	 * the row is the record a disputed decision is answered from, and rewriting the accusation
	 * after the fact would leave that decision explaining text nobody ever read.
	 *
	 * Addressed by target plus the caller, so the row this resolves to is by construction one they
	 * may write. `firstOrFail` answers 404 when they hold no complaint on the target - the same
	 * answer somebody else's complaint gives.
	 */
	public async updateOwn(
		data: ValidatorOutput<ComplaintValidator, 'publicUpdate'>,
		userId: number,
	): Promise<ComplaintEntity> {
		const entry = await this.resolveOwn(
			data.entity_type,
			data.entity_id,
			userId,
		);

		if (entry.is_resolved) {
			throw new BadRequestError(lang('complaint.error.not_editable'));
		}

		if (data.reason !== undefined) {
			entry.reason = data.reason;
		}

		if (data.description !== undefined) {
			entry.description = data.description;
		}

		return this.repository.save(entry);
	}

	/**
	 * @description Used in `delete` method from the public controller
	 *
	 * Withdrawing a complaint, which is a soft delete: the row leaves the moderation queue and
	 * releases its slot under `UQ_complaint_user`, while staying readable to anyone reviewing what
	 * was reported and later taken back.
	 *
	 * Refused once resolved, for the same reason `updateOwn` is - a moderator's decision cannot be
	 * unmade by the person who asked for it.
	 */
	public async deleteOwn(
		data: ValidatorOutput<ComplaintValidator, 'publicDelete'>,
		userId: number,
	): Promise<void> {
		const entry = await this.resolveOwn(
			data.entity_type,
			data.entity_id,
			userId,
		);

		if (entry.is_resolved) {
			throw new BadRequestError(lang('complaint.error.not_withdrawable'));
		}

		await this.repository.createQuery().filterById(entry.id).delete(true);
	}

	/**
	 * @description Used in `read` method from the public controller
	 *
	 * What the caller filed against one target, so the widget that offers "report this" can show it
	 * as already reported instead of walking them into a 409.
	 */
	public getOwn(
		data: ValidatorOutput<ComplaintValidator, 'publicRead'>,
		userId: number,
	): Promise<ComplaintEntity | null> {
		return this.repository
			.createQuery()
			.select(OWN_COLUMNS)
			.filterBy('entity_type', data.entity_type)
			.filterBy('entity_id', data.entity_id)
			.filterBy('user_id', userId)
			.first();
	}

	private resolveOwn(
		entityType: ComplaintEntity['entity_type'],
		entityId: number,
		userId: number,
	): Promise<ComplaintEntity> {
		return this.repository
			.createQuery()
			.filterBy('entity_type', entityType)
			.filterBy('entity_id', entityId)
			.filterBy('user_id', userId)
			.firstOrFail();
	}

	/**
	 * @description Used in `resolveUpdate` method from the dashboard controller
	 *
	 * Both directions of the moderation decision. `CHK_complaint_resolved` ties the flag to the
	 * timestamp, so reopening has to clear `resolved_at` - and `resolved_by` with it, since a
	 * moderator's name against a complaint nobody has decided on reads as a decision.
	 *
	 * `resolvedBy` is nullable because the column is: the caller is authenticated here, but a
	 * decision taken by a background sweep has no user to name, and forcing one would mean
	 * inventing it.
	 */
	public updateResolution(
		entry: ComplaintEntity,
		isResolved: boolean,
		resolvedBy: number | null,
	): Promise<ComplaintEntity> {
		entry.is_resolved = isResolved;
		entry.resolved_at = isResolved ? createCurrentDate() : null;
		entry.resolved_by = isResolved ? resolvedBy : null;

		return this.repository.save(entry);
	}

	/**
	 * @description Used in `delete` method from the dashboard controller
	 *
	 * Soft, so a complaint dismissed as noise is still there to answer for. The row goes on being
	 * readable to anyone allowed to see deleted records, and `restore` brings it back into the
	 * queue.
	 */
	public async delete(id: number): Promise<void> {
		await this.repository.createQuery().filterById(id).delete(true);
	}

	/**
	 * @description Used in `restore` method from the dashboard controller
	 */
	public async restore(id: number): Promise<void> {
		await this.repository.createQuery().filterById(id).restore();
	}

	/**
	 * @description Used by `ComplaintListener`, on `entityRemoved`
	 *
	 * Complaints filed against targets that have just been hard-deleted. `(entity_type,
	 * entity_id)` carries no foreign key, so nothing removes them when the target goes.
	 *
	 * Hard, not soft: the row is being cleared because what it accuses no longer exists, and a
	 * soft-deleted complaint would go on holding its slot under `UQ_complaint_user` while pointing
	 * at nothing. A soft delete here is the reporter withdrawing, which is a different act.
	 */
	public async deleteByTargets(
		entityType: ComplaintEntityType,
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
				.withDeleted()
				.delete(false, true);
		} catch (error) {
			/*
			 * A target nobody reported is the ordinary case, and `RepositoryAbstract.delete`
			 * reports "nothing matched" as a 404 - meaningful when a caller named one row, noise
			 * when the caller is a cleanup sweeping ids it has no expectations about.
			 */
			if (!(error instanceof NotFoundError)) {
				throw error;
			}
		}
	}

	public findById(id: number): Promise<ComplaintEntity> {
		return this.repository.createQuery().filterById(id).firstOrFail();
	}

	/**
	 * @description Used in `read` method from the dashboard controller
	 *
	 * The target is returned as the pair of columns that name it and nothing more. There is no
	 * foreign key to join through - `entity_type` picks the table at read time - and a comment is
	 * hard-deleted, so a complaint whose `entity_id` no longer resolves is a normal row here rather
	 * than a broken one.
	 */
	public getEntryData(
		id: number,
		withDeleted: boolean,
	): Promise<ComplaintEntity> {
		return this.repository
			.createQuery()
			.join('complaint.user', 'user', 'LEFT')
			.select([
				...OWN_COLUMNS,
				...MODERATION_COLUMNS,

				'user.id',
				'user.name',
				'user.email',
			])
			.filterById(id)
			.withDeleted(withDeleted)
			.firstOrFail();
	}

	/**
	 * @description Used in `find` method from the dashboard controller
	 *
	 * The moderation queue. Left unfiltered it lists everything; `is_resolved: false` is the read
	 * `IDX_complaint_open` exists for, and the one the dashboard opens on.
	 */
	public findByFilter(
		data: ValidatorOutput<ComplaintValidator, 'find'>,
		withDeleted: boolean,
	) {
		return this.repository
			.createQuery()
			.join('complaint.user', 'user', 'LEFT')
			.select([
				...OWN_COLUMNS,
				...MODERATION_COLUMNS,

				'user.id',
				'user.name',
			])
			.filterBy('entity_type', data.filter.entity_type)
			.filterBy('entity_id', data.filter.entity_id)
			.filterBy('reason', data.filter.reason)
			.filterBy('user_id', data.filter.user_id)
			.filterBy('resolved_by', data.filter.resolved_by)
			.filterByBoolean('is_resolved', data.filter.is_resolved)
			.filterByTerm(data.filter.term)
			.orderBy(data.order_by, data.direction)
			.pagination(data.page, data.limit)
			.withDeleted(withDeleted && data.filter.is_deleted)
			.all(true);
	}
}

export const complaintService = new ComplaintService(getComplaintRepository());
