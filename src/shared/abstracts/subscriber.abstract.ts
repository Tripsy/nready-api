import type {
	EntitySubscriberInterface,
	InsertEvent,
	RemoveEvent,
	SoftRemoveEvent,
	UpdateEvent,
} from 'typeorm';
import { eventEmitter } from '@/config/event.config';
import type { EntityId } from '@/shared/types/entity-id.type';
import {
	type LogHistoryAction,
	LogHistoryActionEnum,
} from '@/shared/types/log-history.type';

interface BaseEntity {
	id: EntityId;
	deleted_at?: Date | null;
}

type EntityWithTable<T> = {
	new (): T;
	NAME: string;
	HAS_CACHE: boolean;
};

export type SubscriberConfig = {
	afterInsert?: boolean;
	afterUpdate?: boolean;
	beforeRemove?: boolean;
	afterSoftRemove?: boolean;
};

abstract class SubscriberAbstract<T extends BaseEntity>
	implements EntitySubscriberInterface<T>
{
	protected abstract readonly Entity: EntityWithTable<T>;

	protected config: SubscriberConfig = {
		beforeRemove: false,
		afterSoftRemove: false,
		afterInsert: false,
		afterUpdate: false,
	};

	listenTo() {
		return this.Entity;
	}

	protected getEntityName(): string {
		return this.Entity.NAME;
	}

	protected isRestore(event: UpdateEvent<T>): boolean {
		if (!event.entity || !event.databaseEntity) {
			return false;
		}

		if (
			event.entity.deleted_at === undefined ||
			event.databaseEntity.deleted_at === undefined
		) {
			return false; // not a soft-delete entity
		}

		return (
			event.entity.deleted_at === null &&
			event.databaseEntity.deleted_at !== null
		);
	}

	logHistory(
		id: EntityId,
		action: LogHistoryAction,
		data?: Record<string, string | number>,
	) {
		eventEmitter.emit('history', {
			entity: this.getEntityName(),
			entity_ids: [id],
			action: action,
			data: data,
		});
	}

	/**
	 * The id the event concerns, or `undefined` when neither side carries one.
	 *
	 * Both sides can be absent at once: TypeORM schedules a removal for a relation row it never
	 * loaded when `save()` is handed a populated relation the entity was not loaded with, and
	 * such a subject has no `entity.id` and no `databaseEntity` at all. Reading through it threw
	 * and took the whole save down, so the handlers below skip rather than guess an id - an
	 * unidentifiable row has no cache key to clear and nothing meaningful to log.
	 */
	private resolveEventId(event: {
		entity?: { id?: EntityId } | null;
		databaseEntity?: { id?: EntityId } | null;
	}): EntityId | undefined {
		return event.entity?.id ?? event.databaseEntity?.id;
	}

	/**
	 * When entry is removed from the database,
	 * `event.entity` will be undefined if the entity is not properly loaded via Repository
	 *
	 * @param event
	 */
	beforeRemove(event: RemoveEvent<T>) {
		if (!this.config.beforeRemove) {
			return;
		}

		const id = this.resolveEventId(event);

		if (!id) {
			return;
		}

		this.logHistory(id, LogHistoryActionEnum.REMOVED);
	}

	/**
	 * When the entry is marked as deleted in the database,
	 * `event.entity` will be undefined if the entity is not properly loaded via Repository
	 *
	 * @param event
	 */
	afterSoftRemove(event: SoftRemoveEvent<T>) {
		if (!this.config.afterSoftRemove) {
			return;
		}

		const id = this.resolveEventId(event);

		if (!id) {
			return;
		}

		this.logHistory(id, LogHistoryActionEnum.DELETED);
	}

	afterInsert(event: InsertEvent<T>) {
		if (!this.config.afterInsert) {
			return;
		}

		this.logHistory(event.entity.id, LogHistoryActionEnum.CREATED);
	}

	afterUpdate(event: UpdateEvent<T>) {
		if (!this.config.afterUpdate) {
			return;
		}

		const id = this.resolveEventId(event);

		if (!id) {
			return;
		}

		this.logHistory(
			id,
			this.isRestore(event)
				? LogHistoryActionEnum.RESTORED
				: LogHistoryActionEnum.UPDATED,
		);

		// Log `status` change if exist
		if (
			event.entity &&
			event.databaseEntity &&
			'status' in event.entity &&
			'status' in event.databaseEntity &&
			event.entity.status !== event.databaseEntity.status
		) {
			this.logHistory(id, LogHistoryActionEnum.STATUS, {
				oldStatus: event.databaseEntity.status as string,
				newStatus: event.entity.status as string,
			});
		}
	}
}

export default SubscriberAbstract;
