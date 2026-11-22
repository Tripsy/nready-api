import { EventSubscriber, type InsertEvent, type UpdateEvent } from 'typeorm';
import { eventEmitter } from '@/config/event.config';
import { Configuration } from '@/config/settings.config';
import UserEntity, { UserStatusEnum } from '@/features/user/user.entity';
import { createCurrentDate } from '@/helpers/date.helper';
import { encryptPassword } from '@/helpers/security.helper';
import SubscriberAbstract from '@/shared/abstracts/subscriber.abstract';
import type { EntityId } from '@/shared/types/entity-id.type';
import { LogHistoryActionEnum } from '@/shared/types/log-history.type';

@EventSubscriber()
export class UserSubscriber extends SubscriberAbstract<UserEntity> {
	protected readonly Entity = UserEntity;

	constructor() {
		super();

		this.config = {
			beforeRemove: true,
			afterSoftRemove: true,
		};
	}

	async beforeInsert(event: InsertEvent<UserEntity>) {
		// Hash password before inserting a new user.
		if (event.entity.password) {
			event.entity.password = await encryptPassword(
				event.entity.password,
			);
		}

		// Set the default language
		if (!event.entity.language) {
			event.entity.language = Configuration.language();
		}

		event.entity.password_updated_at = createCurrentDate();
	}

	async beforeUpdate(event: UpdateEvent<UserEntity>) {
		// Hash the password before updating if it has changed.
		if (event.entity?.password) {
			event.entity.password = await encryptPassword(
				event.entity.password,
			);
		}
	}

	async afterInsert(event: InsertEvent<UserEntity>) {
		const id = event.entity.id;

		this.logHistory(id, LogHistoryActionEnum.CREATED);

		eventEmitter.emit('userRegistered', event.entity);
	}

	async afterUpdate(event: UpdateEvent<UserEntity>) {
		const id: EntityId = event.entity?.id || event.databaseEntity.id;

		this.logHistory(
			id,
			this.isRestore(event)
				? LogHistoryActionEnum.RESTORED
				: LogHistoryActionEnum.UPDATED,
		);

		// Check if the status was updated
		if (
			event.entity?.status &&
			event.databaseEntity?.status &&
			event.entity.status !== event.databaseEntity.status
		) {
			this.logHistory(id, LogHistoryActionEnum.STATUS, {
				oldStatus: event.databaseEntity.status,
				newStatus: event.entity.status,
			});

			if (event.entity.status === UserStatusEnum.ACTIVE) {
				eventEmitter.emit('userRegistered', {
					id: id,
					name: event.entity.name || event.databaseEntity.name,
					email: event.entity.email || event.databaseEntity.email,
					language:
						event.entity.language || event.databaseEntity.language,
					status: event.entity.status,
				});
			}
		}

		// Check if the password was updated
		if (
			event.entity?.password &&
			event.databaseEntity?.password &&
			event.entity.password !== event.databaseEntity.password
		) {
			this.logHistory(id, LogHistoryActionEnum.PASSWORD_CHANGE);
		}
	}
}
