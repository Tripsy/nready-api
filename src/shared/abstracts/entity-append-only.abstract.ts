import { CreateDateColumn, Entity } from 'typeorm';
import { EntityIdAbstract } from '@/shared/abstracts/entity-id.abstract';

/**
 * Base for tables that are only ever inserted into - ledgers, audit trails, anything whose value
 * comes from being a record of what happened rather than of what is currently believed.
 *
 * Deliberately **not** `EntityAbstract`. That one carries `deleted_at`, and `RepositoryAbstract`
 * soft-deletes by default while every query filters `deleted_at IS NULL` - so a single `delete()`
 * would make a row vanish from every balance and every report while still sitting in the table.
 * A comment saying "never delete this" is not a mechanism; removing the column is.
 *
 * `updated_at` is absent for the same reason: a row that is never edited has nothing to record
 * there, and its presence invites an edit. Corrections are posted as new rows that reference what
 * they cancel.
 */
@Entity()
export abstract class EntityAppendOnlyAbstract extends EntityIdAbstract {
	@CreateDateColumn({ type: 'timestamp', nullable: false })
	created_at!: Date;
}
