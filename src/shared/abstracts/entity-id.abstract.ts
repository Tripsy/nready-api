import { Entity, PrimaryColumn } from 'typeorm';
import type { EntityId } from '@/shared/types/entity-id.type';

/**
 * The UUID v7 primary key every entity carries, directly or through `EntityAbstract` /
 * `EntityAppendOnlyAbstract`.
 *
 * Generated twice over, on purpose:
 * - `EntityIdSubscriber` sets it in the app on every insert TypeORM broadcasts, so a caller holds
 *   the id of a row it is still building
 * - the `uuidv7()` column default (Postgres 18) covers what the subscriber never sees: raw SQL,
 *   and an insert run with `.callListeners(false)`
 *
 * v7 leads with a millisecond timestamp and both generators are monotonic within one process or
 * session, so `ORDER BY id` is creation order and inserts stay at the right edge of the index.
 * The id does reveal when its row was created.
 *
 * Postgres has no `min` / `max` aggregate over `uuid`: pick the first row of a group with
 * `DISTINCT ON (…) … ORDER BY …, id` instead.
 */
@Entity()
export abstract class EntityIdAbstract {
	@PrimaryColumn('uuid', { default: () => 'uuidv7()' })
	id!: EntityId;
}
