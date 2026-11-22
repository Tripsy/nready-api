import { expect, jest } from '@jest/globals';
import type Redis from 'ioredis';
import { CacheProvider, cacheProvider } from '@/providers/cache.provider';
import {
	cleanEntityCache,
	cleanEntityCacheBy,
	cleanEntityCacheMany,
} from '@/shared/abstracts/service.abstract';
import { mockId } from '@/tests/mocks/uuid.mock';

/**
 * Cache invalidation is owned by the service layer and the repository terminals, and this pins its
 * contract: one delete per operation, awaited inside the request, so a client reading straight back
 * after its own write cannot be served the entry it just replaced.
 *
 * The tests spy on `cacheProvider` rather than on an event, because there is no longer an event -
 * a TypeORM subscriber cannot do this job, firing per row and from inside the transaction.
 */

const CachedEntity = { NAME: 'brand', HAS_CACHE: true };
const UncachedEntity = { NAME: 'article_tag', HAS_CACHE: false };

describe('cleanEntityCache', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	/**
	 * The deletes this call performs. It spies on the provider rather than on the emitter: the
	 * clean is awaited inside the request so that a client reading straight back after its own
	 * write cannot be served the entry it just replaced.
	 */
	function capturePatterns(): string[] {
		const captured: string[] = [];

		jest.spyOn(cacheProvider, 'deleteByPattern').mockImplementation(
			async (pattern: string) => {
				captured.push(pattern);
			},
		);

		return captured;
	}

	it('deletes one pattern keyed by entity name and id', async () => {
		const captured = capturePatterns();

		await cleanEntityCache(CachedEntity, mockId(12));

		// Built rather than written out: `buildKey` prefixes the whole keyspace with the app
		// name, and the pattern has to be the one the keys were stored under.
		expect(captured).toEqual([
			`${cacheProvider.buildKey('brand', mockId(12))}*`,
		]);
	});

	it('stays silent for an entity that is not cached', async () => {
		const captured = capturePatterns();

		await cleanEntityCache(UncachedEntity, mockId(12));

		expect(captured).toEqual([]);
	});

	/**
	 * The promise has to be the delete's own. A clean that resolved before the keys were gone
	 * would put back exactly the window awaiting it exists to close, and nothing at the call
	 * site could tell the difference.
	 */
	it('resolves only once the delete has finished', async () => {
		let finished = false;

		jest.spyOn(cacheProvider, 'deleteByPattern').mockImplementation(
			async () => {
				await Promise.resolve();

				finished = true;
			},
		);

		await cleanEntityCache(CachedEntity, mockId(12));

		expect(finished).toBe(true);
	});
});

describe('cleanEntityCacheBy', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	/**
	 * `template` is what this exists for: it is read by label/language/type at render time, so an
	 * id-keyed clean never reaches the entry that lookup serves.
	 */
	it('builds a pattern from every segment given', async () => {
		const captured: string[] = [];

		jest.spyOn(cacheProvider, 'deleteByPattern').mockImplementation(
			async (pattern: string) => {
				captured.push(pattern);
			},
		);

		await cleanEntityCacheBy(
			{ NAME: 'template', HAS_CACHE: true },
			'privacy',
			'en',
			'page',
		);

		expect(captured).toEqual([
			`${cacheProvider.buildKey('template', 'privacy', 'en', 'page')}*`,
		]);
	});

	it('refuses to clean the whole entity when given no segments', async () => {
		const deleteByPattern = jest
			.spyOn(cacheProvider, 'deleteByPattern')
			.mockResolvedValue();

		await cleanEntityCacheBy(CachedEntity);

		// Without the guard the pattern would be `brand*`, dropping every row's cache.
		expect(deleteByPattern).not.toHaveBeenCalled();
	});
});

describe('cleanEntityCacheMany', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it('keeps the narrow pattern for a single id', async () => {
		const deleteByPattern = jest
			.spyOn(cacheProvider, 'deleteByPattern')
			.mockResolvedValue();
		const deleteByIdents = jest
			.spyOn(cacheProvider, 'deleteByIdents')
			.mockResolvedValue();

		await cleanEntityCacheMany(CachedEntity, [mockId(7)]);

		expect(deleteByPattern).toHaveBeenCalledWith(
			`${cacheProvider.buildKey('brand', mockId(7))}*`,
		);
		expect(deleteByIdents).not.toHaveBeenCalled();
	});

	/**
	 * The whole point of `deleteByIdents`: `MATCH` takes one glob, so a loop here would be one
	 * full pass over the keyspace per id - unusable for the bulk deletes the retention crons do.
	 */
	it('makes one pass for many ids instead of one per id', async () => {
		const deleteByPattern = jest
			.spyOn(cacheProvider, 'deleteByPattern')
			.mockResolvedValue();
		const deleteByIdents = jest
			.spyOn(cacheProvider, 'deleteByIdents')
			.mockResolvedValue();

		await cleanEntityCacheMany(CachedEntity, [
			mockId(4),
			mockId(5),
			mockId(6),
		]);

		expect(deleteByIdents).toHaveBeenCalledTimes(1);
		expect(deleteByIdents).toHaveBeenCalledWith('brand', [
			mockId(4),
			mockId(5),
			mockId(6),
		]);
		expect(deleteByPattern).not.toHaveBeenCalled();
	});

	it('stays silent for an entity that is not cached, and for no ids', async () => {
		const deleteByIdents = jest
			.spyOn(cacheProvider, 'deleteByIdents')
			.mockResolvedValue();

		await cleanEntityCacheMany(UncachedEntity, [mockId(4), mockId(5)]);
		await cleanEntityCacheMany(CachedEntity, []);

		expect(deleteByIdents).not.toHaveBeenCalled();
	});
});

describe('CacheProvider.deleteByIdents', () => {
	/**
	 * A stand-in for ioredis: one SCAN page, then a pipeline recording what was deleted. The real
	 * provider is built here rather than reusing the exported singleton, which is the no-op mock
	 * in this environment.
	 */
	function buildProvider(storedKeys: string[]) {
		const deleted: string[] = [];
		let scans = 0;

		const fake = {
			scan: async () => {
				scans += 1;

				return ['0', storedKeys];
			},
			pipeline: () => ({
				del: (key: string) => {
					deleted.push(key);
				},
				exec: async () => [],
			}),
		};

		return {
			provider: new CacheProvider(fake as unknown as Redis),
			deleted,
			scanCount: () => scans,
		};
	}

	/**
	 * The case the whole filter exists for. `4` and `40` share a prefix, so anything matching on
	 * `startsWith` deletes a row nobody asked about - silently, and only for ids that happen to be
	 * a prefix of another.
	 */
	it('matches the ident as a whole segment, not a prefix', async () => {
		const { provider, deleted } = buildProvider([]);
		const keys = [
			`${provider.buildKey('brand', '4', 'read')}`,
			`${provider.buildKey('brand', '40', 'read')}`,
			`${provider.buildKey('brand', '5', 'read')}`,
		];

		const scoped = buildProvider(keys);

		await scoped.provider.deleteByIdents('brand', ['4']);

		expect(scoped.deleted).toEqual([
			`${provider.buildKey('brand', '4', 'read')}`,
		]);
		expect(deleted).toEqual([]);
	});

	it('drops every ident asked for in a single pass', async () => {
		const { provider } = buildProvider([]);
		const scoped = buildProvider([
			provider.buildKey('brand', '4', 'read'),
			provider.buildKey('brand', '5', 'read'),
			provider.buildKey('brand', '6', 'read'),
		]);

		await scoped.provider.deleteByIdents('brand', ['4', '6']);

		expect(scoped.deleted).toEqual([
			provider.buildKey('brand', '4', 'read'),
			provider.buildKey('brand', '6', 'read'),
		]);
		expect(scoped.scanCount()).toBe(1);
	});

	it('matches a key that is the ident alone, with nothing after it', async () => {
		const { provider } = buildProvider([]);
		const scoped = buildProvider([provider.buildKey('brand', '4')]);

		await scoped.provider.deleteByIdents('brand', ['4']);

		expect(scoped.deleted).toEqual([provider.buildKey('brand', '4')]);
	});
});
