import { lang } from '@/config/message.setup';
import { BadRequestError, CustomError } from '@/exceptions';
import { cacheProvider } from '@/providers/cache.provider';
import type { StatusTransitions } from '@/shared/types/common.type';
import type { EntityId } from '@/shared/types/entity-id.type';

export type EntityWithCache = {
	NAME: string;
	HAS_CACHE: boolean;
};

/**
 * Drops an entity's cached entries.
 *
 * **Cache invalidation belongs to the service and the repository terminals, never to a TypeORM
 * subscriber.** A row-level hook cannot do this job for two reasons:
 *
 * 1. *It fires per row.* Saving three translations broadcasts three identical cleans, each a full
 *    Redis SCAN over the same keyspace, all but the first finding nothing. The service knows the
 *    write was one operation on one article; the row-level hook cannot.
 * 2. *It fires inside the transaction.* A concurrent reader can slip between the subscriber's
 *    DELETE and the COMMIT, refill the cache from a snapshot that is about to be superseded, and
 *    leave it stale with no further write coming to correct it. Cleaning after commit closes that
 *    window; no amount of deduplication downstream can.
 *
 * **Awaited inside the request**, so the write is readable by whoever made it - the dashboard
 * re-reads an entry the moment its form submit resolves, and a clean handed to a background task
 * would let that read be answered with the entry it just replaced.
 *
 * Call it **after** the transaction commits. Inside one it reintroduces reason 2 exactly.
 *
 * @param {EntityWithCache} entity - Entity class whose `NAME` prefixes the cache keys
 * @param {number} id - Row whose keys should be dropped
 */
export async function cleanEntityCache(
	entity: EntityWithCache,
	id: EntityId,
): Promise<void> {
	return cleanEntityCacheBy(entity, id);
}

/**
 * The same, for a keyspace addressed by something other than the row id.
 *
 * `template` is the case this exists for: it is read by `label`/`language`/`type` at render time,
 * so an id-keyed clean leaves that lookup serving the old body until its TTL. Everything else in
 * the codebase keys on the id, and should keep doing so - a segment order that puts a literal
 * before the id (`<entity>:some-group:<id>`) is unreachable by `cleanEntityCache` and has silently
 * outlived its writes before.
 */
export async function cleanEntityCacheBy(
	entity: EntityWithCache,
	...segments: (string | number)[]
): Promise<void> {
	if (!entity.HAS_CACHE || segments.length === 0) {
		return;
	}

	await cacheProvider.deleteByPattern(
		`${cacheProvider.buildKey(entity.NAME, ...segments.map(String))}*`,
	);
}

/**
 * The same for many rows at once, in a single pass over the keyspace.
 *
 * A loop of `cleanEntityCache` is a full SCAN per id, so a bulk delete of a few thousand rows would
 * scan the keyspace a few thousand times. One ident stays on the narrow `MATCH` - cheaper when
 * Redis can skip most of the keyspace - and anything more goes wide and filters in the client.
 */
export async function cleanEntityCacheMany(
	entity: EntityWithCache,
	ids: EntityId[],
): Promise<void> {
	if (!entity.HAS_CACHE || ids.length === 0) {
		return;
	}

	if (ids.length === 1) {
		return cleanEntityCacheBy(entity, ids[0]);
	}

	await cacheProvider.deleteByIdents(
		entity.NAME,
		ids.map((id) => id.toString()),
	);
}

export function assertValidStatusTransition<S extends string>(
	statusTransitions: StatusTransitions<S>,
	currentStatus: S,
	newStatus: S,
) {
	if (currentStatus === newStatus) {
		throw new BadRequestError(
			lang('shared.error.status_unchanged', { status: newStatus }),
		);
	}

	const allowed = statusTransitions[currentStatus] || [];

	if (!allowed.includes(newStatus)) {
		throw new CustomError(
			409,
			lang('shared.error.status_update_not_allowed', {
				currentStatus: currentStatus,
				newStatus: newStatus,
			}),
		);
	}
}
