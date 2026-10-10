import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { lang } from '@/config/message.setup';
import { RedisRateLimitStore } from '@/config/rate-limit.store';
import { Configuration } from '@/config/settings.config';
import { cacheProvider } from '@/providers/cache.provider';

export type RateLimiterType = 'api' | 'authLogin' | 'authDefault';

const instances = new Map<RateLimiterType, ReturnType<typeof rateLimit>>();

const baseConfig = {
	windowMs: 15 * 60 * 1000,
	legacyHeaders: false,
	standardHeaders: 'draft-6' as const,
	/*
	 * Disabled under `test`, like `authMiddleware` in `app.ts`, and by `RATE_LIMIT_ENABLED=false`
	 * (`rateLimit.enabled`) for load testing.
	 *
	 * One limiter instance is cached per type, so `register`, `passwordRecover` and
	 * `emailConfirmSend` all share a single 10-per-15-minutes budget. In a suite that
	 * counter carries across every test in the file, which makes results depend on how
	 * many requests ran before - adding a case anywhere can push an unrelated one into a
	 * 429. Nothing asserts rate-limiting behavior, so there is nothing to lose by
	 * skipping it.
	 *
	 * `test` is the only exemption. An address allowlist would be one a caller can put
	 * themselves on: in production `req.ip` is read from `X-Forwarded-For`, so naming a
	 * listed address in that header switches rate limiting off for exactly the callers it
	 * exists to catch.
	 */
	skip: () =>
		Configuration.isEnvironment('test') ||
		!Configuration.get('rateLimit.enabled'),
	/*
	 * A Redis outage lets requests through rather than failing every one of them with a 500 -
	 * losing the limiter for the length of an outage is the smaller harm than losing the API.
	 */
	passOnStoreError: true,
};

/**
 * Who a budget belongs to. `user` counts a signed-in caller by account and falls back to the
 * address for visitors: an office or mobile carrier puts many users behind one IP, and counting
 * them together throttles the lot once one of them is busy. `authMiddleware` runs before every
 * route, so `res.locals.auth` is settled by the time the limiter reads it.
 *
 * The credential limiters stay on `ip`. Their routes are visitor-only, and a guessing attempt
 * has no account to be counted against.
 */
type RateLimitScope = 'user' | 'ip';

const keyGenerators: Record<
	RateLimitScope,
	(req: Request, res: Response) => string
> = {
	user: (req, res) => {
		const userId = res.locals.auth?.id;

		return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? '');
	},
	ip: (req) => ipKeyGenerator(req.ip ?? ''),
};

const configs: Record<
	RateLimiterType,
	typeof baseConfig & {
		message: string;
		limit: number;
		scope: RateLimitScope;
	}
> = {
	api: {
		...baseConfig,
		// About one request a second sustained; a single page of the UI issues several
		limit: 1000,
		scope: 'user',
		message: 'shared.rate_limit.message.default',
	},
	authLogin: {
		...baseConfig,
		limit: 10,
		scope: 'ip',
		message: 'shared.rate_limit.message.login',
	},
	authDefault: {
		...baseConfig,
		limit: 10,
		scope: 'ip',
		message: 'shared.rate_limit.message.default',
	},
};

/**
 * The limiter's budget in words, for the API documentation.
 *
 * Read off `configs` rather than restated in the docs files, so raising a limit here also
 * corrects what the published reference promises.
 */
export function describeRateLimit(type: RateLimiterType): string {
	const { limit, windowMs, scope } = configs[type];
	const per =
		scope === 'user'
			? 'per user, or per IP address for visitors'
			: 'per IP address';

	return `${limit} requests per ${windowMs / 60000} minutes ${per}`;
}

export function getRateLimiter(type: RateLimiterType = 'api') {
	const existing = instances.get(type);

	if (existing) {
		return existing;
	}

	const { scope, ...config } = configs[type];

	const limiter = rateLimit({
		...config,
		keyGenerator: keyGenerators[scope],
		// One store per limiter - `express-rate-limit` refuses a store shared between two
		store: new RedisRateLimitStore(
			`${cacheProvider.buildKey('rate_limit', type)}:`,
		),
		message: async () => ({
			status: 429,
			error: lang('shared.rate_limit.error'),
			message: lang(configs[type].message),
		}),
	});

	instances.set(type, limiter);

	return limiter;
}

export const apiRateLimiter = getRateLimiter('api');
export const authLoginRateLimiter = getRateLimiter('authLogin');
export const authDefaultRateLimiter = getRateLimiter('authDefault');
