import { hostname } from 'node:os';
import { v7 as uuid } from 'uuid';
import { getRedisClient } from '@/config/init-redis.config';
import { Configuration } from '@/config/settings.config';

/*
 * Deletes the key only while it still holds the token this holder wrote. A plain DEL would
 * release a lock that expired under a slow holder and was since taken by someone else.
 */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
	return redis.call('del', KEYS[1])
end
return 0
`;

export type Lock = {
	readonly key: string;
	acquire(): Promise<boolean>;
	release(): Promise<void>;
};

/**
 * A mutual-exclusion lock shared by every process on the same Redis - the equivalent of a
 * `flock` on a file every server mounts.
 *
 * `leaseMs` is how long the lock outlives a holder that never releases it: a process killed
 * mid-run, or one whose work hangs. Set it well above the longest legitimate hold - a holder
 * still working when the lease runs out loses the lock without knowing, and a second one can
 * take it.
 *
 * One `Lock` tracks one hold at a time; acquiring again before releasing replaces the token
 * it remembers.
 */
export function createLock(name: string, leaseMs: number): Lock {
	const key = [Configuration.get('redis.keyPrefix'), 'lock', name]
		.filter((segment) => segment !== '')
		.join(':');

	let token: string | null = null;

	return {
		key,

		async acquire(): Promise<boolean> {
			const candidate = `${hostname()}:${process.pid}:${uuid()}`;

			const result = await getRedisClient().set(
				key,
				candidate,
				'PX',
				leaseMs,
				'NX',
			);

			if (result !== 'OK') {
				return false;
			}

			token = candidate;

			return true;
		},

		async release(): Promise<void> {
			if (!token) {
				return;
			}

			const held = token;
			token = null;

			await getRedisClient().eval(RELEASE_SCRIPT, 1, key, held);
		},
	};
}
