import type { IncrementResponse, Options, Store } from 'express-rate-limit';
import { getRedisClient } from '@/config/init-redis.config';

/*
 * Fixed window: the first hit in a window sets the expiry, later hits only count. INCR and the
 * expiry run as one script, so a crash between the two cannot leave a counter that never resets.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
	redis.call('PEXPIRE', KEYS[1], ARGV[1])
	ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

/**
 * Hit counts kept in Redis, so every API replica draws on the same budget - the in-memory default
 * gives each replica its own, multiplying the limit by the replica count.
 *
 * The script goes out with plain `EVAL` on every hit rather than loaded once for `EVALSHA`: a load
 * done at startup is a promise that, with Redis unreachable at that moment, stays rejected and
 * switches limiting off until a restart. Redis caches the compiled script either way; the cost is
 * a few hundred bytes per request.
 *
 * Errors propagate - `passOnStoreError` in `rate-limit.config.ts` decides what an outage means.
 * `init` touches no connection, so building a limiter under `test` (where every limiter is
 * skipped) never reaches for Redis.
 */
export class RedisRateLimitStore implements Store {
	public readonly localKeys = false;
	private windowMs = 0;

	constructor(public readonly prefix: string) {}

	init(options: Options): void {
		this.windowMs = options.windowMs;
	}

	async increment(key: string): Promise<IncrementResponse> {
		const [totalHits, ttl] = (await getRedisClient().eval(
			INCREMENT_SCRIPT,
			1,
			this.prefix + key,
			this.windowMs,
		)) as [number, number];

		return {
			totalHits: totalHits,
			resetTime: new Date(Date.now() + ttl),
		};
	}

	async decrement(key: string): Promise<void> {
		await getRedisClient().decr(this.prefix + key);
	}

	async resetKey(key: string): Promise<void> {
		await getRedisClient().del(this.prefix + key);
	}
}
