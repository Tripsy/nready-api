import {
	type EntitySubscriberInterface,
	EventSubscriber,
	type InsertEvent,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * Gives every row its UUID v7 in the app before the insert, so a caller holds the id of a row it
 * is still building - for a child row, an event or an idempotency key - without reading it back.
 *
 * A subscriber listening to every entity rather than a `@BeforeInsert` method on
 * `EntityIdAbstract`: a method becomes part of each entity's type, and every object literal typed
 * as an entity - a spread row, a mock - would then have to carry it.
 *
 * Fires for every insert TypeORM broadcasts - `save()`, `insert()` and a QueryBuilder
 * `.insert().values()`. Raw SQL and an insert run with `.callListeners(false)` get the `uuidv7()`
 * column default instead.
 */
@EventSubscriber()
export class EntityIdSubscriber implements EntitySubscriberInterface {
	beforeInsert(event: InsertEvent<{ id?: EntityId }>): void {
		if (event.entity && !event.entity.id) {
			event.entity.id = uuidv7();
		}
	}
}
