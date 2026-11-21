/**
 * The primary key of every table, and of every column referencing one: a UUID v7 in its
 * canonical lowercase string form, which is how the pg driver hands back a `uuid` column.
 *
 * An alias rather than a bare `string` so a reader - and a grep - can tell an id from any
 * other text.
 */
export type EntityId = string;
