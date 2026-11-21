import {
	EventSubscriber,
	type InsertEvent,
	type RemoveEvent,
	type SoftRemoveEvent,
	type UpdateEvent,
} from 'typeorm';
import UserPermissionEntity from '@/features/user-permission/user-permission.entity';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import { LogHistoryActionEnum } from '@/shared/types/log-history.type';

/**
 * Audit only. These four overrides exist for their action mapping, which is deliberately *not* the
 * base class's - `beforeRemove` records `DELETED` and `afterSoftRemove` records `REMOVED`, the
 * reverse of `SubscriberAbstract`, and an update is recorded only when it is a restore. Do not
 * collapse them into the base; it would rewrite the audit trail.
 *
 * The cache these writes affect belongs to `user`, not to this table, and is dropped by
 * `UserPermissionService` - see the note there.
 */
@EventSubscriber()
export class UserPermissionSubscriber extends SubscriberAbstract<UserPermissionEntity> {
	protected readonly Entity = UserPermissionEntity;

	beforeRemove(event: RemoveEvent<UserPermissionEntity>) {
		const id: EntityId = event.entity?.id || event.databaseEntity.id;

		this.logHistory(id, LogHistoryActionEnum.DELETED);
	}

	afterSoftRemove(event: SoftRemoveEvent<UserPermissionEntity>) {
		const id: EntityId = event.entity?.id || event.databaseEntity.id;

		this.logHistory(id, LogHistoryActionEnum.REMOVED);
	}

	afterInsert(event: InsertEvent<UserPermissionEntity>) {
		const id = event.entity?.id;

		this.logHistory(id, LogHistoryActionEnum.CREATED);
	}

	afterUpdate(event: UpdateEvent<UserPermissionEntity>) {
		if (this.isRestore(event)) {
			const id: EntityId = event.entity?.id || event.databaseEntity.id;

			this.logHistory(id, LogHistoryActionEnum.RESTORED);
		}
	}
}
